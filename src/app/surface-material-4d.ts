import * as THREE from "three";
import {
  BACKGROUND_SHAPE_GLSL,
  backgroundShapeSource,
} from "../fractal/background-shape";
import { radiusBandInvRange } from "../fractal/surface-de-4d";
import type { SurfaceDE4 } from "../fractal/surface-de-4d";
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
import type { Vec3 } from "../fractal/types";
import {
  configureSurfaceLUTTexture,
  SURFACE_FULL_AO_TAPS,
  SURFACE_FULL_HIT_FLOOR,
  SURFACE_FULL_MARCH_STEPS,
  SURFACE_FULL_SHADOW_STEPS,
  surfaceFragmentFor,
  surfaceFragmentResolvedFor,
} from "./surface-material";
import type {
  SurfaceBalloonSpec,
  SurfaceGroundPlaneSpec,
} from "./surface-material";
import { DARK_BACKDROP, hexToRgb01 } from "./constants";
import { lightDirection } from "./voxel-material";

/**
 * The 4D surface render's GPU sphere-tracer — the 4D twin of
 * `surface-material.ts`: a full-screen-quad ShaderMaterial that marches
 * camera rays against an analytic distance estimator for the `w = w0`
 * SLICE of a 4D IFS attractor — width-4 beam inverse-map descent with
 * REFINED sibling certificates, precomputed by `buildSurfaceDE4`
 * (`src/fractal/surface-de-4d.ts`) and packed here into the fixed-size
 * arrays of a std140 uniform BLOCK (that block is what lets the cap match
 * 3D's 24 maps). The refined certificate — one extra Hutchinson level
 * applied to every escaped, non-descended sibling before it freezes into
 * the running min — was the 4D surface spike's measured ghost-eliminator
 * (0.0% ghost-of-hits on every slice measured, down from a 4.7-84.6% range
 * unrefined); beam width 4 is hardcoded here exactly as in the 3D shader.
 * The rank-3/4 validity slots ride along too — extra chains that stay live
 * only while their image is in-sphere. Kaleidoscope sectors are SWEPT from
 * two default-block uniforms (`uSymOrder` + the backward-step
 * `uSymStepBack`) rather than expanded into slots — the 3D tracer's
 * sector-sweep shape one dimension up, with the whole `mat4` standing in
 * for 3D's `(cos, sin)` pair because a 4D double rotation carries two
 * angles; the slab query's half-extent rotates through the same matrix (an
 * isometry maps segments to segments).
 *
 * The rotor and w-slice arrive as VIEW uniforms rather than baked into the
 * packed maps: every query lifts `q = uInvRotor * vec4(p, uW0)` into the
 * attractor frame before the DE runs, which is valid because a rotation is
 * an isometry — distances, march steps, and gradients all survive the lift
 * unchanged.
 *
 * The slice has a THICKNESS. With `uSliceHalfW > 0` the query stops being
 * the point `(p, uW0)` and becomes the SEGMENT spanning `|w - uW0| <=
 * uSliceHalfW` over `p`, so what the tracer marches is a SLAB's projected
 * shadow rather than a single cross-section — thin structure that a
 * zero-thickness plane can only ever catch edge-on reads as solid. Affine
 * maps take segments to segments, which is why the whole descent
 * generalizes term for term: one extra `vec4` beside every chain's and
 * candidate's point (moved by each inverse map's LINEAR part alone —
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
 *
 * TWO ORTHOGONAL SCENE ARMS ride this source, the 4D halves of
 * capabilities that had shipped 3D-only: the BALLOON inverted union and
 * the GROUND PLANE floor, each lifting its 3D arm. Both are `#if` arms
 * resolved JS-side by {@link surface4FragmentFor}, so a session that wants
 * neither hands the driver the byte-identical source it always did;
 * `material.defines` carries the pair for change detection and as a
 * program-cache key, never as driver-parsed text. They are mutually
 * exclusive for the 3D reason, unchanged in 4D: there is no horizon inside
 * an enclosing shell. Independent per-transform FINISH and PATTERN arms
 * (`SURFACE_FINISH`/`SURFACE_PATTERN`, {@link setSurface4Materials}) share
 * the fixed A/B wire. Finish contributes the 3D tracer's `finishShade` body;
 * this plumbing bead gives pattern its calibration and compile gate but no
 * formula yet. Both compose with the scene arms. Their 4D-specific decision
 * is that the material lanes remain UNCONDITIONAL members of the
 * `SurfaceMaps4` std140 block, so the layout never moves when either gate
 * flips.
 *
 * THE BALLOON IS SLICE-THEN-INVERT, and that single sentence is the whole
 * 4D content of the lift. `I(p) = c + R²(p−c)/|p−c|²` is a plain 3D
 * inversion of the MARCHED point, applied BEFORE the descent's
 * `uInvRotor * vec4(p, uW0)` lift — so the echo is the 3D inversion of
 * exactly the slice being drawn, the explorer echo's own convention
 * (`scene.ts`'s shared-geometry echo Points), and the arm is textually the
 * 3D one: it wraps the `vec3` overloads and never touches `w`. The
 * alternative — inverting in the attractor frame and slicing afterwards —
 * would put `R`, `rho` and the center in a frame the rotor spins, so the
 * shell would swim every time the user tumbled the view, which is the
 * opposite of what a single continuous radius parameter means.
 *
 * THE BALLOON BALL IS THE ORIGIN AND THE FULL 4D VISIBLE RADIUS, decided
 * host-side (this shader only reads `uBalloon*`). `SurfaceDE4` is
 * origin-anchored by construction — there is no `boundCenter` in 4D, and
 * `buildSurfaceDE4` records why a centred fit must not be copied down from
 * 3D blindly — and the FULL radius, rather than `main()`'s slice-adjusted
 * `sliceVisR`, keeps the shell stable while the slice slider scrubs. It
 * stays conservative either way: the slice lies inside `ball(0, R4)`,
 * since `|q| <= |(q, w0)| <= R4`.
 *
 * The union's one structural difference from 3D is an ABSENCE: no
 * `balloonInnerDE` far-field clamp. That clamp exists in 3D for its two
 * FORWARD-ORBIT cores, whose far value is not a distance to anything; this
 * tracer has exactly one core, the certified beam descent, whose far field
 * IS its value-exact depth-0 sphere floor. The wrapper composes over
 * `surfaceDEFractal` directly, and a future 4D forward core would owe the
 * clamp.
 *
 * THE GROUND PLANE IS THE 3D PLANE VERBATIM. The floor lives in the sliced
 * 3D world space the camera orbits, so its geometry, its radial fade and
 * both analytic ball certificates are dimension-free; the only 4D content
 * sits inside `surfaceDE`, which lifts every shading tap through
 * `uInvRotor` and therefore lights the floor with the slice actually being
 * drawn. One thing the 4D `main()` had to GROW rather than copy: the
 * post-march miss now splits sphere-exit (`t > tFar`, may plane) from
 * budget EXHAUSTION (background, always) — 3D splits it because it has a
 * floor to split it for, and before the floor's 4D lift both outcomes here
 * painted the same backdrop so nothing distinguished them.
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
 * `twentyFourCellFlake`) can be surfaced.
 *
 * The cap sat at 16 while the arrays lived in the DEFAULT uniform block,
 * where they cost ~8 of WebGL2's guaranteed 224 fragment uniform VECTORS
 * per slot (a mat4 array element takes 4 rows; a float or vec3 element
 * takes a whole row each — 4 + 1 + 1 + 1 + 1) — 24 slots would have been
 * 192 rows, plus the ~33 misc uniforms below, close enough to a link
 * failure on minimum-spec devices to be worth avoiding. The cap raise
 * moved them into the std140 uniform BLOCK declared in the fragment shader
 * below, which is budgeted separately: 24 slots of mat4 + 3 vec4 = 24 *
 * (64 + 16 + 16 + 16) = 2688 bytes of the 16 KB block size (and 1 of the
 * 12 fragment blocks) every WebGL2 device guarantees. Raising the cap
 * further is now a matter of how much per-ray DESCENT cost the tracer can
 * afford, not of uniform space.
 *
 * Kaleidoscope sectors are swept from uniforms rather than expanded into
 * slots (see surface-de-4d.ts's SYMMETRY section), so 24 slots means 24
 * transforms at ANY symmetry order. The app gates systems whose map count
 * exceeds it before entering the mode, so {@link setSurfaceSystem4}
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
  /** Sphere-trace step budget per ray — a per-tier uniform, in lockstep
   * with the 3D tracer's. Tracer-side only, like the loop caps
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
   * block: 24 slots cost 2688 bytes of the 16 KB every WebGL2 device
   * guarantees per block, where the same arrays as default-block uniforms
   * would have eaten 192 of the guaranteed 224 fragment uniform vectors.
   * Only the first uMapCount slots are meaningful; the rest are
   * stale/identity and never read. One slot per INPUT transform at any
   * kaleidoscope order — sectors are swept, not expanded (see uSymOrder
   * below).
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
    /** Per-map surface FINISH lanes (surface-finish.ts: A = specular,
     * shininess, metalness, reflect; B = transmit, reserved). UNCONDITIONAL
     * members, read only by the finish arm in main(): a define-gated
     * member would move the std140 offsets on every toggle — see the
     * UniformsGroup. */
    vec4 uMapFinishA[MAX_MAPS];
    vec4 uMapFinishB[MAX_MAPS];
  };
  uniform int uMapCount;
  /** Kaleidoscope sectors swept around every base map (>= 1). 1 leaves the
   * sweep a single pass with no rotation, which is what keeps
   * non-symmetric systems bit-identical to the pre-sweep tracer. Default
   * block, like uMapCount — three's UBO writer is float-only, so ints stay
   * out of the block. */
  uniform int uSymOrder;
  /** One BACKWARD sector step, a whole mat4: the transpose of the forward
   * copy rotation symmetryRotation4(plane, 2*PI/order, twist) — a 4D double
   * rotation carries two angles, so the matrix stands in for the 3D
   * tracer's single (cos, sin) pair (see the oracle's stepSector4).
   * Identity when there is no kaleidoscope; never read at uSymOrder 1
   * either way. Not per-map data, so it lives beside uSymOrder rather than
   * growing the std140 block above. */
  uniform mat4 uSymStepBack;
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
  /** Radial color band of the visible set (SurfaceDE4.radiusBand): the
   * probe's 4D bounds-center plus the [minD, maxD] distance range from it,
   * delivered as minD and 1/range so the radius source below maps the band
   * onto the whole ramp exactly the way buildColors4's radius mode
   * does. Attractor-frame constants — no swim under rotor or slice moves. */
  uniform vec4 uRadiusCenter4;
  uniform float uRadiusMinD;
  uniform float uRadiusInvRange;
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
   * NUMBER: their slice window is written in normalized rotated-w (q.w *
   * uInvWAmp4), and scene.ts's setSurface4View converts the shared slider
   * through wSupport on the way here. Backticks would end
   * this template literal, so this whole GLSL source names code plainly. */
  uniform float uW0;
  /** HALF-THICKNESS of the marched SLAB, a literal world w in the view
   * frame — the same units and the same frame as uW0. 0 is the
   * zero-thickness hyperplane this tracer shipped with, and every term
   * below collapses to that path's arithmetic bit for bit (see
   * segmentRadius); above 0 each query becomes the SEGMENT the slab |w -
   * uW0| less than or equal to uSliceHalfW cuts over the queried 3D point,
   * so the render shows the slab's whole shadow rather than one
   * cross-section. The validity argument — affine maps take segments to
   * segments, so every chain carries one extra vec4 and every ball
   * certificate reads a segment radius — is the SLAB QUERIES section of
   * surface-de-4d.ts's module doc, which this shader mirrors. */
  uniform float uSliceHalfW;
  /** Base-color source: 0 = by-transform (uMapColorSigma.xyz), 1 = orbit-trap
   * palette, 2 = height ramp, 3 = radius ramp, 4 = orbit rings, 5 = orbit
   * sheets. Sources 1-5 sample uColorLUT. */
  uniform int uColorSource;
  /** Per-level decay of the orbit-trap blend weight (flam3's color speed):
   * 0.5 = the classic halving, 0 = pure depth-0 regions, 1 =
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
  /** Backdrop gradient SHAPE: mirrors the 3D tracer's
   * uBgShape/uBgCenter/uBgScale line for line — see the 3D twin. */
  uniform int uBgShape;
  uniform vec2 uBgCenter;
  uniform vec2 uBgScale;
  /** Depth-fog density multiplier: scales the traveled-distance term of
   * the fog blend below (main()'s float fog computation), mirroring the 3D
   * tracer's uFogDensity line for line — 1 is the fixed fog it replaced, 0
   * (scene-set floor) fades it away entirely. Scene-set, independent of
   * the installed system — see scene.ts's
   * setFogDensity. */
  uniform float uFogDensity;
  /** Fog tint: what the depth fog blends toward is mix(background,
   * uFogTint, uFogTintStrength), mirroring the 3D tracer's uFogTint line
   * for line — strength 0 (the default) is a bit-exact identity, the
   * pre-tint fog toward the pixel's own
   * backdrop color. scene.setFogTint keeps both current. */
  uniform vec3 uFogTint;
  uniform float uFogTintStrength;
  /** Environment-light strength; 0 is a bit-exact identity.
   * Tints the WHOLE lit term — see the 3D twin for why not ambient only. */
  uniform float uEnvLight;
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
  /** surface-finish.ts's ONE lighting body, GLSL dialect — the 3D twin's
   * splice line for line; define-gated because it is value- not
   * byte-identical to the fixed formula at the classic lanes. */
  ${surfaceFinishShadeSource(SURFACE_FINISH_GLSL, true)}
#endif
#if SURFACE_PATTERN
  /** One compact native-carrier calibration per built DE/session; deliberately
   * outside the fixed per-map std140 block. */
  uniform vec4 uPatternCalibration;
  /** The SURFACE_PATTERN shading arm's ONE shared body — the 3D tracer's
   * splice, character for character (surface-pattern-shade.ts): the two
   * tracers differ only in how main() reconstructs and normalizes the
   * source hit, never in the pattern arithmetic. */
  ${surfacePatternShadeSource()}
#endif
  ${backgroundShapeSource(BACKGROUND_SHAPE_GLSL)}
  /** Angular pixel footprint of the ACTIVE buffer (scene-set per frame):
   * sizes the shading probes (normal offsets, ray dither) to the pixels
   * actually being rendered — not the hit test; see uAcceptPixelEps. */
  uniform float uPixelEps;
  /** Angular pixel footprint of the FULL-RESOLUTION frame,
   * tier-INDEPENDENT (mirrored from the 3D tracer): hit acceptance and the
   * DE cutoff run at max(uAcceptPixelEps * t, uBoundingRadius * uHitFloor)
   * in every tier — a tier may coarsen sampling, never acceptance, so a
   * preview can never accept a hit the settle frame would reject. The 3D
   * declaration's doc carries the measured fold-phantom mechanism that
   * forced this; the 4D tracer takes the same contract for lockstep. */
  uniform float uAcceptPixelEps;
  /** Where inside its pixel THIS pass aims, the 3D tracer's jitter uniform
   * line for line: .xy the offset in UV, .zw the same offset in pixels,
   * both derived by the scene from surface-compute.ts's subPixelSample.
   * All zero is the pixel CENTRE, so every single-pass trace — and pass 0
   * of a supersampled settle — adds exactly 0.0 and renders the
   * pre-supersampling frame value for value. The ray's UV moves and the
   * dither's hash takes the jittered pixel; the background ramp
   * deliberately does not. The 3D declaration's doc
   * carries the reasoning. */
  uniform vec4 uPixelJitter;

  in vec2 vUv;
  out vec4 outColor;

  /** Per-pixel dither for the march start so grazing rays don't band. */
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  /** Distance from the ORIGIN to the segment q + s*e, s in [-1, 1] — the
   * slab query's stand-in for length(q) at every radius, escape test and
   * ball certificate the descent computes (the oracle's own segmentRadius,
   * and the SLAB QUERIES section of surface-de-4d.ts's module doc). s is
   * the segment's own parameter at closest approach: the unconstrained
   * minimizer of the squared length is -dot(q, e) / dot(e, e), and
   * clamping it to the segment's ends turns the infinite LINE's distance
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

  /** The segment parameter s in [-1, 1] at that same closest approach —
   * segmentRadius's argmin, shared guard and all. Every affine inverse map
   * preserves the parameterization — T^-1(q + s e) is T^-1(q) + s * (M e)
   * — so a chain tuple's s lives on the ORIGINAL query segment at any
   * depth.
   * 0 at e = 0: the point query has no segment to place a hit on. */
  float segmentS(vec4 q, vec4 e) {
    float ee = dot(e, e);
    return ee > 0.0 ? clamp(-dot(q, e) / ee, -1.0, 1.0) : 0.0;
  }

  /** One sector step of the kaleidoscope sweep (the oracle's stepSector4):
   * turn a chain point BACKWARD by one sector — the transpose of the
   * rotation copy k applies AFTER its base map, so descending through the
   * copy un-rotates first. One branchless mat4 multiply, simpler than 3D's
   * stepSector: a double rotation has two angles, so the whole matrix ships
   * as a uniform where 3D derived three plane branches from one (cos, sin)
   * pair. A slab query's half-extent takes the same multiply at the call
   * sites — an isometry maps segments to segments. */
  vec4 stepSector4(vec4 q) {
    return uSymStepBack * q;
  }

  /** One extra Hutchinson level on a frozen escaped candidate's own
   * inverse image (the oracle's refinedCert): the certificate becomes
   * childScale * max(r - R, min sigmaMin_j * (|invMap_j(img)| - R)) —
   * never below the base childScale * (r - R), with the min over every
   * (sector, base map) pair, which the sweep spells out exactly as the
   * oracle's refinedCert does — skipping the rotated pieces would skip
   * candidates the descent itself sweeps. The 4D surface spike measured
   * this exact refinement eliminating every march ghost.
   *
   * imgExt is the candidate's segment half-extent, rotated one backward
   * step per sector alongside the point and carried through each inner map
   * by its LINEAR part alone, turning that |invMap_j(img)| into a segment
   * radius; zero — the point query — leaves every term above unchanged.
   * The segment flag is recomputed from uSliceHalfW here rather than
   * passed, because a free function sees no caller scope; it is the same
   * dynamically-uniform test the descent bodies hoist, so both
   * branches cost nothing across a draw. */
  float refinedCert4(vec4 img, vec4 imgExt, float r, float childScale) {
    bool segment = uSliceHalfW > 0.0;
    float inner = 1e30;
    vec4 sImg = img;
    vec4 sExt = imgExt;
    for (int k = 0; k < uSymOrder; k++) {
      if (k > 0) {
        sImg = stepSector4(sImg);
        if (segment) {
          sExt = uSymStepBack * sExt;
        }
      }
      for (int j = 0; j < uMapCount; j++) {
        vec4 jImg = uInvM[j] * sImg + uInvT[j];
        vec4 jExt = segment ? uInvM[j] * sExt : vec4(0.0);
        float rj = segmentRadius(jImg, jExt);
        inner = min(inner, uMapColorSigma[j].w * (rj - uBoundingRadius));
      }
    }
    return childScale * max(r - uBoundingRadius, inner);
  }

#if SURFACE_BALLOON
// The balloon inverted-union scene, one dimension up (the 3D arm wraps the
// same CPU oracle). The wrapper past the descent bodies composes
// fractal/balloon-de.ts's estimateBalloonDistance over this tracer's
// public DE — this rename points the descent's three definitions at
// surfaceDEFractal so the wrapper can own the public names, the
// SURFACE_FOLD_LENS idiom the 3D file borrowed it from.
//
// SLICE THEN INVERT is the whole 4D decision. I(p) is a PLAIN 3D inversion
// of the MARCHED point, applied BEFORE the descent's
// uInvRotor * vec4(p, uW0) lift, so the echo is the 3D inversion of exactly
// the slice being drawn rather than a 4D inversion sliced afterwards — the
// explorer echo's precedent (scene.ts's shared-geometry echo Points). The
// arm is therefore textually the 3D one: it wraps the vec3 overloads and
// never touches w. This module's doc carries the argument in full.
//
// uBalloon* are packed by setSurface4Balloon from buildBalloon's
// convention: center + MARGINED rho (the bound's divisor), R in world
// units, uBalloonFar = BALLOON_FAR_CAP_RHO * raw ball radius. The ball is
// the ORIGIN and the FULL 4D visible radius, which is the host's decision
// and not this arm's — see the module doc.
uniform vec3 uBalloonCenter;
uniform float uBalloonR;
uniform float uBalloonRho;
uniform float uBalloonFar;
// The echo's own tint, the 3D arm's uBalloonTint/ uBalloonTintStrength
// verbatim, packed by the SAME packSurfaceBalloonTint (surface-material.ts
// — both materials declare these names). Mixed into the BASE COLOUR of a
// shell hit, before lighting; strength 0 is the default and mix(x, y, 0.0)
// == x exactly, so an unset tint is today's frame byte for byte.
uniform vec3 uBalloonTint;
uniform float uBalloonTintStrength;
#define surfaceDE surfaceDEFractal
#endif
  /**
   * Both surfaceDE overloads mirror estimateDistance4Refined in
   * src/fractal/surface-de-4d.ts (the tested CPU oracle) — any change
   * there must land in BOTH bodies here, and vice versa. Width-4 BEAM
   * inverse-map descent (paired A/B chains, ported one dimension up by the
   * 4D surface spike) with REFINED sibling certificates (that spike's
   * measured ghost-eliminator: one extra Hutchinson level applied to a
   * candidate's own inverse image before it freezes into the running min)
   * — hardcoded here exactly as 3D hardcodes its beam width, so there is
   * no 'wide' flag and no width-1 branch to port. The rank-3/4 validity
   * slots ride along as extra V1/V2 chains, live only while their image
   * stays in-sphere — an escaped rank-3/4 candidate folds the same refined
   * certificate instead, exactly as it would without the slots. Refined
   * folds replace plain ones at the single per-candidate EVICTION fold
   * (whichever tuple the rank-1..4 ladders displace) and the two rank-3/4
   * PROMOTE folds (a validity candidate that escaped before it could
   * occupy V1/V2); the two ESCAPE-RADIUS folds and the two TERMINAL folds
   * at loop end (chains A/B only — validity chains fold no terminal at
   * all) stay PLAIN, exactly as estimateDistance4Refined keeps them —
   * refining those would cost another inverse-map sweep for candidates
   * already destined for the running min by a cheaper route. Every refined
   * fold site carries the oracle's laziness guard: refinement can only
   * RAISE a certificate, so a fold whose PLAIN certificate already fails
   * to beat the running min is skipped whole — bit-exact, and it caps the
   * inner sweeps at the folds that actually advance the min (measured on
   * the beam harness: tesseract 1504 -> 450 apps/call, values unchanged).
   * 1e30 stands in for Infinity (slot-occupancy tests use < 1e29): with
   * sigma products <= 1 and real distances O(1..10) it can never be
   * confused for a real bound. This plain overload is the workhorse
   * (march, normals, shadow, occlusion); the out-param overload below adds
   * hit-shading extras.
   *
   * EARLY-OUT CUTOFF, mirroring the oracle's cutoff parameter. The march
   * needs a HIT DECISION, not a distance, so it passes its own acceptance
   * epsilon and the descent stops as soon as the value it would return is
   * already below it. A cutoff of 0.0 — the zero-argument overload below,
   * every tap that needs the DISTANCE — is the full descent. Above the
   * cutoff the value is the full-descent one (early exits only ever return
   * BELOW it, so step lengths never drift); below it, the full descent
   * would have landed below too, so the hit verdict is identical. Both
   * rest on best only ever FALLING, and on the exits testing it only after
   * a fold has SETTLED it — refined, here — never on the raw plain
   * certificate that gates the fold. Exiting on the latter would re-open
   * the ghost class refinement exists to kill: a barely-escaped sibling
   * dips under the epsilon, the full descent lifts it back above.
   *
   * SPHERE FLOOR, mirroring the oracle's own unconditional exit. Once best
   * falls to or below sphereBound the return is already pinned at
   * sphereBound * uFinalSigmaMin — the epilogue clamps through max(best,
   * sphereBound), and best only ever falls, so no later fold can lift the
   * clamp back off sphereBound. The descent therefore exits the instant
   * best <= sphereBound, unconditionally — no cutoff involved. Unlike the
   * cutoff exit above, this one is value-exact for EVERY caller, including
   * a cutoff of 0.0 (the zero-argument overload below): it returns the
   * full-descent value bit-for-bit, always. Live on anisotropic maps
   * (certificates lose a sigmaMin/sigmaMax factor per level and dip under
   * the floor); provably dead on isotropic invariant-ball maps, where
   * certificates never dip (see the oracle's paragraph).
   *
   * SLAB QUERIES, mirroring the oracle's halfExtent parameter. The query
   * is no longer the single point (p, uW0) but the SEGMENT it spans
   * through the slab of half-thickness uSliceHalfW — the part of |w - uW0|
   * less than or equal to uSliceHalfW sitting over p — so the marched
   * object is the slab's shadow rather than one cross-section. Affine maps
   * take segments to segments, so the whole descent carries one extra vec4
   * beside each chain's and candidate's point, pushed through the inverse
   * map's LINEAR part alone (a translation slides a segment's centre and
   * leaves its extent alone), and every |q| - R ball certificate becomes
   * segmentRadius(q, ext) - R. Beam, validity slots, refined certificates,
   * terminal KIFS bound, depth-0 sphere floor, final lens and both early
   * exits are structurally untouched; the bound only loosens, by at most
   * uSliceHalfW (see the oracle's HOW MUCH THE BOUND CAN LOSE), and the
   * zero set is exactly the shadow being marched, so nothing new can go
   * unsound. Cost: uSliceHalfW greater than 0 is the segment flag each
   * body hoists, DYNAMICALLY UNIFORM across a draw, so the propagation
   * branches cost nothing when the slab is off — but the extra vec4 per
   * chain, candidate, eviction and image slot is live register pressure
   * either way, the one price this pays unconditionally. At uSliceHalfW ==
   * 0 every value here is today's, bit for bit: segmentRadius degenerates
   * to length, and a zero extent stays zero through any linear map.
   *
   * SECTOR SWEEP, mirroring the oracle's kaleidoscope. Each chain point
   * (and its slab half-extent — an isometry maps segments to segments)
   * turns one backward step per sector via uSymStepBack, and every base
   * map is applied to it there, sector-major (k*n + i, the chaos-game
   * expansion's slot order), so the candidate stream — keys, certificates,
   * tie-breaks — is exactly the expanded system's without a single
   * expanded slot. uSymOrder 1 leaves the k > 0 branches dead:
   * non-symmetric systems run the pre-sweep arithmetic unchanged. The
   * oracle module's SYMMETRY section carries the validity argument and why
   * a single wedge FOLD would not be sound here.
   */
  float surfaceDE(vec3 p, float cutoff) {
    // View -> attractor frame: a rotation is an isometry, so the DE's
    // distances and gradients survive the lift untouched; then the final
    // lens, exactly as the oracle's prologue.
    vec4 q = uInvRotor * vec4(p, uW0);
    // The query's half-extent, carried alongside the point down every
    // chain. Zero — the shipped slider position — is the point query this
    // tracer shipped with, and every term below collapses to it exactly
    // (see segmentRadius). The slab's half-extent in the ATTRACTOR frame:
    // a w displacement of uSliceHalfW in the view frame is uSliceHalfW
    // times the inverse rotor's w column.
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
    // sphere floor case now has its own unconditional exit — the
    // sphere-floor pin below — that fires the moment best reaches it,
    // cutoff or not.)
    float bailBelow =
      (cutoff > 0.0 && sphereBound * uFinalSigmaMin < cutoff) ? cutoff : -1e30;
    // Chain slot A starts at the (lensed) query; slot B idles until beam
    // selection fills it. Each chain carries the contraction accumulated
    // INCLUDING its own map and the radius it was selected at, plus its
    // own segment half-extent — one vec4 where the oracle unrolls a
    // 4-element buffer.
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
    // Validity chains: they hold the level's rank-3/4 candidates ONLY
    // while their points are in-sphere, and carry no R field — unlike A/B
    // they never fold a terminal (see past the loop), and expansion
    // re-derives every child radius, so the selection radius is dead
    // weight once occupancy is decided.
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
        // Sector sweep, the 3D tracer's shape one dimension up: the chain
        // point — and, under a slab query, its half-extent, since the
        // backward step is an isometry taking segments to segments — turns
        // one step per kaleidoscope sector, and every BASE map is applied
        // to it there, so the candidates and their SECTOR-MAJOR
        // enumeration order (k*n + i, exactly chaos-game-4d's expansion
        // slots) are the ones the expansion would have produced. The
        // ladders below therefore break ties the same way, and the beam,
        // the validity slots and the exits see an unchanged stream. See
        // the oracle module's SYMMETRY section for why a single wedge FOLD
        // would not be sound here.
        vec4 sQ = pQ;
        vec4 sExt = pExt;
        for (int k = 0; k < uSymOrder; k++) {
          if (k > 0) {
            sQ = stepSector4(sQ);
            if (segment) {
              sExt = uSymStepBack * sExt;
            }
          }
          for (int j = 0; j < uMapCount; j++) {
            vec4 img = uInvM[j] * sQ + uInvT[j];
            // uInvM[j] carries no translation — uInvT[j] is a separate
            // member — so this IS the inverse map's linear part, all a
            // segment's half-extent ever sees.
            vec4 imgExt = segment ? uInvM[j] * sExt : vec4(0.0);
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
            // their REFINED certificate (one extra Hutchinson level closes
            // the barely-escaped-sibling ghost) — skipped whole when its
            // plain certificate cannot beat the running min anyway (the
            // oracle's laziness guard, bit-exact); an in-sphere tuple
            // carries no positive certificate — it can only get here past
            // FOUR smaller keys, the (shrunken) residual drop the validity
            // slots left.
            if (eR > uBoundingRadius && eCert < best) {
              best = min(best, refinedCert4(eQ, eExt, eR, eScale));
              // Cutoff exit plus the sphere-floor pin: the folded
              // certificate is FINALIZED (already refined), and best only
              // falls from here. Once best is at or below sphereBound the
              // return is already pinned at sphereBound * uFinalSigmaMin no
              // matter how much further best still falls, so that case
              // exits unconditionally; short of it, the settled verdict
              // against the caller's cutoff means the rest of the descent
              // cannot lift it back either.
              if (best <= sphereBound || best * uFinalSigmaMin < bailBelow) {
                return max(best, sphereBound) * uFinalSigmaMin;
              }
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
      // Cutoff exit plus the sphere-floor pin, covering the four promote
      // folds above in one test: each either wrote a settled certificate
      // into best (refined at the two validity-slot sites, the
      // deliberately plain escape-radius bound at the other two) or
      // continued a chain, and best only falls from here. Once best is at
      // or below sphereBound the eventual return is already pinned at
      // sphereBound * uFinalSigmaMin, so that case exits unconditionally.
      // Deliberately NOT a break: the terminal bounds past the loop are
      // folds the FULL descent only makes at the depth cap, and folding
      // one here could drop best below a value that descent never reaches.
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
   * has one chain at scale 1, so the selection key ranks by radius alone).
   * trap is a flame-style structural blend of the winning candidates'
   * palette coordinates, accumulated TOP-DOWN with geometrically decaying
   * weight (level d weighs uColorSpeed^d, normalized at the end; 0.5 is
   * the classic decay): the depth-0 choice — which top-level copy of the
   * attractor the hit sits in — dominates the final coordinate, matching
   * flam3's convention where the LAST-applied transform dominates a
   * plotted point's color (descent order is application order reversed, so
   * descent level 0 is the most significant digit; the previous
   * deepest-first recurrence rendered as per-pixel palette noise). rings
   * is the classic geometric orbit trap: the winning chain's closest
   * radial approach |image|/R across the descent, min-tracked exactly
   * where the trap blend samples — radial shells in raw attractor space
   * that follow the fractal's own structure. sheets is rings' plane-trap
   * sibling: the winning chain's closest approach |image.y|/R to the
   * attractor frame's y = 0 plane, min-tracked the same way — nested
   * laminar bands cutting across the structure. (An escape-depth extra was
   * tried in this slot first and swapped out pre-release: on
   * uniform-contraction systems the escape level is pinned by the hit
   * epsilon, not local structure, and it rendered one flat hue.) sStar is
   * the slab hit's own place along the query segment: the level winner's
   * closest-approach parameter, overwritten per level so the DEEPEST
   * resolved level — the contracted neighborhood the accepted hit actually
   * sits in — reports; inverse maps preserve the segment parameterization
   * (see segmentS), so it reads directly on the original |w - uW0| <=
   * uSliceHalfW span, and main()'s radius color lifts through w0 + sStar *
   * uSliceHalfW. Always 0 at uSliceHalfW = 0. It follows the per-level
   * best candidate and stops when every chain has escaped. Called ONCE per
   * hit; the march itself uses the plain overload.
   *
   * The slab query rides here identically — same extent prologue, same
   * vec4 per chain, candidate and eviction slot, same segmentRadius at
   * every ball certificate — because lockstep with the plain overload IS
   * the contract; only the extras above are extra. Of those, rings
   * inherits the segment radius (it reads c1R, which is one), while sheets
   * keeps reading the chain centre's y: shading, not distance. The sector
   * sweep rides the same way, and c1Map stays the BASE map index j
   * whichever sector the winning candidate came from — every kaleidoscope
   * copy of a map colors as that map, exactly chaos-game-4d's
   * transformIndices discipline.
   */
  float surfaceDE(
    vec3 p,
    out int firstChoice,
    out float trap,
    out float rings,
    out float sheets,
    out float sStar
  ) {
    vec4 q = uInvRotor * vec4(p, uW0);
    // The slab query's half-extent, exactly as the plain overload's
    // prologue derives it — see that body's doc comment.
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
    // Validity chains: they hold the level's rank-3/4 candidates ONLY
    // while their points are in-sphere, and carry no R field — unlike A/B
    // they never fold a terminal (see past the loop), and expansion
    // re-derives every child radius, so the selection radius is dead
    // weight once occupancy is decided.
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
    sStar = 0.0;
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
        // Sector sweep, the 3D tracer's shape one dimension up: the chain
        // point — and, under a slab query, its half-extent, since the
        // backward step is an isometry taking segments to segments — turns
        // one step per kaleidoscope sector, and every BASE map is applied
        // to it there, so the candidates and their SECTOR-MAJOR
        // enumeration order (k*n + i, exactly chaos-game-4d's expansion
        // slots) are the ones the expansion would have produced. The
        // ladders below therefore break ties the same way, and the beam,
        // the validity slots and the exits see an unchanged stream. See
        // the oracle module's SYMMETRY section for why a single wedge FOLD
        // would not be sound here.
        vec4 sQ = pQ;
        vec4 sExt = pExt;
        for (int k = 0; k < uSymOrder; k++) {
          if (k > 0) {
            sQ = stepSector4(sQ);
            if (segment) {
              sExt = uSymStepBack * sExt;
            }
          }
          for (int j = 0; j < uMapCount; j++) {
            vec4 img = uInvM[j] * sQ + uInvT[j];
            // uInvM[j] carries no translation — uInvT[j] is a separate
            // member — so this IS the inverse map's linear part, all a
            // segment's half-extent ever sees.
            vec4 imgExt = segment ? uInvM[j] * sExt : vec4(0.0);
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
            // their REFINED certificate (one extra Hutchinson level closes
            // the barely-escaped-sibling ghost) — skipped whole when its
            // plain certificate cannot beat the running min anyway (the
            // oracle's laziness guard, bit-exact); an in-sphere tuple
            // carries no positive certificate — it can only get here past
            // FOUR smaller keys, the (shrunken) residual drop the validity
            // slots left.
            if (eR > uBoundingRadius && eCert < best) {
              best = min(best, refinedCert4(eQ, eExt, eR, eScale));
            }
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
      // Under a slab query rings rides the SEGMENT radius, since c1R is
      // one; sheets keeps reading the segment's CENTRE y by design — a
      // shading extra, not part of the distance contract, and a coordinate
      // is what the plane trap wants.
      sheets = min(sheets, abs(c1Q.y) / uBoundingRadius);
      // Overwritten, not min-tracked: the deepest level's winner is the
      // honest place along the slab segment (see the doc above).
      sStar = segmentS(c1Q, c1Ext);
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

#if SURFACE_BALLOON
#undef surfaceDE
  // The balloon union: fractal/balloon-de.ts's estimateBalloonDistance
  // mirrored term for term over the descent's public DE. min(DE(p),
  // (|p-c|/rho)*DE(I(p))) is conservative at every R — a min of two
  // conservative bounds — and the shell term's cutoff scales by the inverse
  // of its value factor, so the cutoff early-exit contract survives
  // verbatim (the oracle's module doc carries both arguments; nothing about
  // either is dimension-specific, which is why this arm is the 3D one
  // textually).
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
  // NO balloonInnerDE here, and that is a real difference from the 3D arm
  // rather than an omission. The union requires its inner estimator to be
  // far-field SOUND — a true lower bound outside the ball — because the
  // balloon march is the one marcher that evaluates it out there. 3D needs
  // a clamp because two of its cores are FORWARD ORBITS whose far value is
  // not a distance to anything (escape's |q|/dr, the bulb's Boettcher
  // form). This tracer has exactly ONE core, the certified beam descent,
  // whose far field IS the value-exact depth-0 sphere floor
  // max(best, sphereBound) * uFinalSigmaMin. So the union composes over
  // surfaceDEFractal directly — and a future 4D forward-orbit core would
  // have to bring the clamp with it.
  float surfaceDE(vec3 p, float cutoff) {
    float dF = surfaceDEFractal(p, cutoff);
    float scale;
    vec3 q = balloonInvert(p, scale);
    float dS =
      scale * surfaceDEFractal(q, cutoff > 0.0 ? cutoff / scale : 0.0);
    return min(dS, dF);
  }
  float surfaceDE(vec3 p) {
    float dF = surfaceDEFractal(p);
    float scale;
    vec3 q = balloonInvert(p, scale);
    float dS = scale * surfaceDEFractal(q);
    return min(dS, dF);
  }
  // Hit-info with argmin routing (the oracle's attribution convention: ties
  // -> fractal). The descent runs at the WINNING term's own query point,
  // and colorPos reports that point so the height/radius color sources read
  // the shell's SOURCE geometry instead of clamping at the far wall. sStar
  // rides out with the rest and is the winning descent's own segment
  // parameter, so a shell hit's radius color lifts through the w its source
  // point sits at rather than the slab's centre plane — the one output the
  // 3D wrapper has no counterpart for. shell mirrors the same argmin as a
  // 0/1 flag — 1.0 when the inverted echo term won, 0.0 on the fractal term
  // or a tie — so the caller can restrict the tint mix to shell hits alone;
  // kept right after colorPos, with sStar staying the trailing output.
  float surfaceDEBalloonHitInfo(
    vec3 p,
    out vec3 colorPos,
    out float shell,
    out int firstChoice,
    out float trap,
    out float rings,
    out float sheets,
    out float sStar
  ) {
    float dF = surfaceDEFractal(p);
    float scale;
    vec3 q = balloonInvert(p, scale);
    float dS = scale * surfaceDEFractal(q);
    if (dS < dF) {
      colorPos = q;
      shell = 1.0;
      return scale *
        surfaceDEFractal(q, firstChoice, trap, rings, sheets, sStar);
    }
    colorPos = p;
    shell = 0.0;
    return surfaceDEFractal(p, firstChoice, trap, rings, sheets, sStar);
  }

#endif
#if SURFACE_GROUND_PLANE
  /** Ground plane, the 3D arm VERBATIM: an infinite one-sided floor at y =
   * uGroundY, dropped below the session ball (uGroundBallC/uGroundBallR —
   * balloonBall's convention, certified to contain the visible set),
   * receiving the fractal's penumbra shadow. Only rays that MISS the
   * fractal reach it: the ball sits strictly above the plane, so along any
   * downward ray every possible surface hit precedes the plane crossing —
   * the floor can never occlude geometry.
   *
   * Nothing here is 4D-aware, deliberately. The floor lives in the SLICED
   * 3D world space the camera orbits, so its geometry, its fade and both
   * analytic ball certificates are dimension-free; the only 4D content is
   * inside surfaceDE, which lifts each tap through uInvRotor and therefore
   * lights the floor with the slice actually being drawn. There is no
   * probe descent in 4D (the width-1 probe split is a fold-GLSL affordance
   * the 4D tracer never grew), so the taps call the public value overload,
   * as the 3D arm calls its own.
   *
   * The one reading worth spelling out is uVisibleRadius: in this tracer it
   * is the FULL 4D radius, not main()'s sliceVisR. That is the right scale
   * for a floor — the fog normalizer and the shadow-step clamp then stay
   * slice-INVARIANT, so the floor under the object does not breathe as the
   * w-slice slider scrubs, where sliceVisR would collapse toward 0 at the
   * slab's edges and take the floor's fog with it.
   *
   * Uniforms live in this arm rather than the shared block so the OFF
   * variants' resolved source stays byte-identical (the uBalloonCenter
   * precedent). */
  /** The out param cov is the trace-alpha coverage flag: 1 where the floor
   * was actually lit, 0 where this function returned the caller's own
   * backdrop. The WebGPU arm counts a PLANE terminal for exactly those
   * pixels, so the two engines' blank-frame arithmetic agrees on a
   * document with a
   * floor. */
  vec3 shadeGroundPlane(vec3 ro, vec3 rd, vec3 background, out float cov) {
    cov = 0.0;
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
    //      marching; the estimator's far field is its value-exact sphere
    //      floor, so the gated and marched answers agree at the boundary.
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

    return mix(background, col, fade);
  }

#endif
  void main() {
    // The shared background shape at full-image coordinates; see the 3D
    // twin.
    vec3 background = mix(uBgBottom, uBgTop, backgroundShapeT(vUv));

    // Reconstruct the camera ray by unprojecting this pixel on the near
    // and far clip planes — at the supersampling pass's own point inside
    // the pixel (the pixel centre on every single-pass trace).
    vec2 ndc = (vUv + uPixelJitter.xy) * 2.0 - 1.0;
    vec4 nearP = uInvProjView * vec4(ndc, -1.0, 1.0);
    vec4 farP = uInvProjView * vec4(ndc, 1.0, 1.0);
    vec3 rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
    vec3 ro = uCamPos;

    // The 3D ball the marched w-SLAB of the visible 4D set can occupy:
    // |(p, w)| <= uVisibleRadius implies |p| <= this (rotation preserves
    // the 4D norm), taken at the slab's most generous w — the |w| in
    // [|uW0| - uSliceHalfW, |uW0| + uSliceHalfW] closest to 0, since a
    // smaller |w| leaves a wider 3D ball. Empty when the whole slab sits
    // past the visible radius. At uSliceHalfW == 0 this is abs(uW0)
    // squared, the zero-thickness value bit for bit.
    float sliceMinW = max(abs(uW0) - uSliceHalfW, 0.0);
    float sliceVisR =
      sqrt(max(uVisibleRadius * uVisibleRadius - sliceMinW * sliceMinW, 0.0));

#if SURFACE_BALLOON
    // Balloon mode DROPS the slice's visible-sphere gate (the oracle
    // module's march-entry semantics): every ray can hit the enclosing
    // shell, so every ray marches from the camera, capped at uBalloonFar
    // past the balloon center — capped rays fall through to the existing
    // background below (the balloon is a HIT, not a background). The
    // sphere entry still seeds the fog origin, so the FRACTAL's own depth
    // fog is unchanged — and for rays that MISS the sphere the origin is
    // the closest-approach depth max(-b, 0), NOT 0: both forms meet at the
    // silhouette (disc -> 0 collapses the entry to -b), so the fog origin
    // is CONTINUOUS across the whole frame. Shell hits nearer than the
    // origin clamp fog at zero (the min just before the fog term).
    float radius = sliceVisR * 1.02;
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float disc = b * b - c;
    float tFar = length(uCamPos - uBalloonCenter) + uBalloonFar;
    float t = 0.0;
    float tEnter = max(-b - (disc >= 0.0 ? sqrt(disc) : 0.0), 0.0);
#else
    // Entry/exit against the origin-centered sphere bounding the slice's
    // visible set (small margin so silhouettes right at the bound aren't
    // clipped): solve |ro + t rd|^2 = radius^2. No intersection, or an exit
    // behind the camera, is a miss.
    float radius = sliceVisR * 1.02;
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) {
#if SURFACE_GROUND_PLANE
      float planeCov;
      outColor = vec4(shadeGroundPlane(ro, rd, background, planeCov), planeCov);
#else
      outColor = vec4(background, 0.0);
#endif
      return;
    }
    float sq = sqrt(disc);
    float tFar = -b + sq;
    if (tFar <= 0.0) {
#if SURFACE_GROUND_PLANE
      float planeCovExit;
      outColor =
        vec4(shadeGroundPlane(ro, rd, background, planeCovExit), planeCovExit);
#else
      outColor = vec4(background, 0.0);
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
    for (int i = 0; i < uMarchSteps; i++) {
      if (t > tFar) {
        break;
      }
      // Tier-independent acceptance — see uAcceptPixelEps.
      float eps = max(uAcceptPixelEps * t, uBoundingRadius * uHitFloor);
      float d = surfaceDE(ro + rd * t, eps);
      if (d < eps) {
        hit = true;
        break;
      }
      t += d * uStepScale;
    }
    if (!hit) {
#if SURFACE_GROUND_PLANE
      // Sphere-exit misses land on the floor; budget-EXHAUSTED rays stay
      // background (their geometry is unresolved) — the WGSL march
      // kernel's status split, mirrored, and the one place the 4D floor
      // lift had to ADD structure rather than copy it: 3D splits this miss
      // because it has a floor to split it for, and the 4D loop never did,
      // both outcomes painting the same backdrop. EXHAUSTED must never
      // plane, or a ray that ran out of steps INSIDE the object would
      // paint floor through it.
      if (t > tFar) {
        float planeCovMiss;
        outColor = vec4(
          shadeGroundPlane(ro, rd, background, planeCovMiss),
          planeCovMiss
        );
        return;
      }
      // Alpha 0 for a MISS and — deliberately — for an EXHAUSTED ray too,
      // which is the compute arm's own rule: a ray that spent its budget
      // resolved no geometry, so it drew nothing.
#endif
      outColor = vec4(background, 0.0);
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
    float sStar;
#if SURFACE_BALLOON
    // Argmin routing: a shell hit's extras come from the descent at its
    // INVERTED query point, and cpos carries that point to the
    // height/radius color sources below.
    vec3 cpos;
    float shell;
    surfaceDEBalloonHitInfo(
      pos,
      cpos,
      shell,
      firstChoice,
      trap,
      rings,
      sheets,
      sStar
    );
#else
    surfaceDE(pos, firstChoice, trap, rings, sheets, sStar);
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
    // color.ts's ONE ramp definition — no ramp math lands here; rings and
    // sheets arrive pre-normalized from the descent.
    vec3 base;
    if (uColorSource == 0) {
      base = uMapColorSigma[clamp(firstChoice, 0, uMapCount - 1)].xyz;
    } else {
      float u;
      if (uColorSource == 1) {
        u = trap;
#if SURFACE_BALLOON
      // The winning term's SOURCE point: a shell hit reads its
      // PRE-inversion geometry, so the ramps sweep the same range as the
      // fractal's own instead of clamping at the far wall. Both
      // position-driven sources take it. The radius source keeps the
      // radius-band normalization and the slab lift unchanged — see the
      // non-balloon branches in this module's source, which this variant
      // replaces rather than extends — with cpos for pos, and sStar the
      // SHELL descent's own segment parameter, so point and w stay a pair.
      } else if (uColorSource == 2) {
        u = clamp(cpos.y / uVisibleRadius * 0.5 + 0.5, 0.0, 1.0);
      } else if (uColorSource == 3) {
        vec4 q4 = uInvRotor * vec4(cpos, uW0 + sStar * uSliceHalfW);
        u = clamp(
          (length(q4 - uRadiusCenter4) - uRadiusMinD) * uRadiusInvRange,
          0.0,
          1.0
        );
#else
      } else if (uColorSource == 2) {
        // Height normalizes against the visible bounding sphere. The 4D
        // radius is slice-invariant, so height (a plain 3D world-space
        // coordinate) doesn't swim as uW0 slides either.
        u = clamp(pos.y / uVisibleRadius * 0.5 + 0.5, 0.0, 1.0);
      } else if (uColorSource == 3) {
        // The TRUE 4D radius, matching the cloud's 4D radius color mode:
        // lift the hit back into the attractor frame and measure its
        // distance from the probe's 4D center, normalized over the
        // content band [minD, maxD] the way buildColors4's radius branch
        // normalizes over the radius band — dividing by the full visible
        // radius instead used only the narrow sub-band [minD, maxD]/visR4
        // of the ramp, which in 4D rendered whole frames in one hue.
        // length() of a center-relative offset is rotation-invariant and
        // the band is an attractor-frame constant, so this reading is
        // invariant under BOTH rotor spins and slice moves — unlike a
        // plain 3D length(pos), which would swim under either.
        //
        // Under a slab (uSliceHalfW > 0) the hit can sit anywhere in |w -
        // uW0| <= uSliceHalfW; the descent's sStar — the deepest level
        // winner's segment parameter — places it, so the ramp reads the
        // hit's OWN w rather than flattening to the slab's centre plane.
        // At uSliceHalfW = 0, sStar is 0 and this is the slice plane
        // exactly, bit for bit.
        vec4 q4 = uInvRotor * vec4(pos, uW0 + sStar * uSliceHalfW);
        u = clamp(
          (length(q4 - uRadiusCenter4) - uRadiusMinD) * uRadiusInvRange,
          0.0,
          1.0
        );
#endif
      } else if (uColorSource == 4) {
        u = rings;
      } else {
        u = sheets;
      }
      base = texture(uColorLUT, vec2(u, 0.5)).rgb;
    }
#if SURFACE_BALLOON
    // The echo's own tint, on the BASE ALBEDO before lighting — shell
    // restricts it to the inverted term (the oracle's own attribution;
    // ties go to the fractal), so a fractal-term hit is untouched at any
    // strength. strength 0 (the default) makes this mix(base,
    // uBalloonTint, 0.0) == base — today's frame byte for byte.
    base = mix(base, uBalloonTint, uBalloonTintStrength * shell);
#endif
#if SURFACE_PATTERN
    // Patterned albedo, BEFORE lighting and fog — the document's order:
    // color source -> balloon tint -> pattern -> lighting -> fog. The
    // pattern is object-attached, so the albedo reads the RAW attractor
    // point, reconstructed by reversing the render's remaps in the
    // surface-pattern-frame.ts order (visible hit -> balloon source query
    // -> inverse 4D view -> final inverse). The hit's OWN w is inserted
    // BEFORE the inverse rotor — doing it afterward would screen-lock any
    // w-mixing pose — via the winning descent's segment parameter sStar;
    // the affine final inverse then lands in the raw attractor frame, and
    // the raw bounding radius (never the live slice radius) normalizes.
    // The hit's own slot picks its material from the shared B lane; the
    // footprint is the tier-INDEPENDENT acceptance epsilon at the hit
    // depth, normalized by the raw bounding radius, so preview and settle
    // tiers cannot change the material detail.
    vec4 patternSource4 = vec4(pos, uW0 + sStar * uSliceHalfW);
#if SURFACE_BALLOON
    if (shell > 0.5) {
      patternSource4 = vec4(cpos, uW0 + sStar * uSliceHalfW);
    }
#endif
    vec4 patternLifted = uInvRotor * patternSource4;
    vec4 patternRaw = uFinalInvM * patternLifted + uFinalInvT;
    vec3 objectP = patternRaw.xyz / uBoundingRadius;
    float patternFootprint = uAcceptPixelEps * t / uBoundingRadius;
    int patternSlot = clamp(firstChoice, 0, uMapCount - 1);
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
    // the surface to dodge self-shadowing. Leaving the slice's visible
    // sphere means fully lit from there on, and near-black penumbras end
    // early.
    float shadow = 1.0;
    float ts = h * 2.0;
    for (int i = 0; i < uShadowSteps; i++) {
      vec3 sp = pos + n * h * 2.0 + uLightDir * ts;
#if SURFACE_BALLOON
      // The balloon receives shadows, never casts them: shadow rays test
      // the FRACTAL alone, so the enclosing shell cannot black out the
      // scene it wraps. Tetra normal and AO stay on the public union
      // forms. surfaceDEFractal directly, where 3D needs its clamped
      // balloonInnerDE — this tracer's one core is far-field sound already
      // (see the note above the wrapper), and a shell hit launching this
      // ray from far outside the ball walks in on the sphere floor.
      float d = surfaceDEFractal(sp);
#else
      float d = surfaceDE(sp);
#endif
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

#if SURFACE_FINISH
    // The hit's depth-0 map picks its AUTHORED finish — the 3D twin's
    // fetch line for line, over the std140 lanes.
    int fSlot = clamp(firstChoice, 0, uMapCount - 1);
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
    // traveled inside the slice's visible sphere — ~0.38 haze at the far
    // side (a full 2R chord), a depth cue matching the explorer's fog feel
    // (constants tuned by eye).
    float fog =
      1.0 - exp(-0.12 * pow((t - tEnter) * uFogDensity / max(sliceVisR, 1.0e-6), 2.0));
    col = mix(col, mix(background, uFogTint, uFogTintStrength), clamp(fog, 0.0, 1.0));

    // Alpha is the COVERAGE flag, not an opacity: 1 where the frame drew
    // something, 0 where it shows only its backdrop. The 3D tracer's
    // convention, mirrored so scene.ts's settle fold can count either
    // arm's output with one loop. Invisible because BLIT_FRAGMENT strips
    // it to 1 at every present (three r163+ makes the canvas alpha:true
    // regardless, and a coverage-0 pixel reaching it composited the page
    // background into the pane).
    outColor = vec4(col, 1.0);
  }
`;

/**
 * Compose the fragment source for a variant selection: `balloon` and
 * `plane`, the two scene arms above, resolved JS-side so the driver only
 * ever parses the arms a session actually uses.
 *
 * REUSED, NOT RE-DERIVED. {@link surfaceFragmentFor} already IS this
 * resolver: it takes the source as a parameter, it owns the `#if` nesting
 * bookkeeping, it owns the plane-over-balloon REFUSAL (no horizon inside
 * the shell — a `RangeError`, and callers gate first, so reaching it is a
 * bug), and it owns the SIZE RULE, which strips comments and indentation
 * from any resolved source past `SURFACE_GLSL_STRIP_BYTES` (64KB).
 * Standing up a second preprocessor here is precisely the drift the
 * twin-file convention exists to prevent — two copies of "what does this
 * directive mean" is how a 3D system and its 4D lift start rendering
 * different objects — so the arms in `SURFACE4_FRAGMENT` carry the 3D
 * directive NAMES and this wrapper pins the three 3D-only flags at 0.
 * `SURFACE_ESCAPE`, `SURFACE_BULB` and `SURFACE_FOLD_LENS` simply never
 * appear in this source (fold-shaped and forward-orbit 4D sessions are
 * compute-only), so pinning them costs nothing.
 *
 * WHY JS-SIDE AT ALL, when three.js would happily prepend two defines and
 * let the driver's own preprocessor do it — preprocessor-DEAD text still
 * costs SOURCE BYTES, and source bytes are what Mesa prices (the 3D file's
 * measured ladder: ~68KB links in ~25s, ~80KB was called the cliff, 82.2KB
 * crashed the compiler outright, empty info log, lost context). MEASURED
 * here, raw resolved / what the driver gets:
 *
 * - off:     62765 B (61.3KB) / 62765 B — under 64KB, so NOT stripped
 *            (2771 B of headroom, down from 3148 B: the finish lanes'
 *            two UNCONDITIONAL block members and their four-line doc
 *            cost 377 B raw, 56 B of them live tokens, in every 4D
 *            program — the price of a layout that does not move when
 *            the finish define flips; before them the radial backdrop
 *            branch's 2732 B, itself down from 2825 B, since the shared
 *            backgroundShapeT body and its three new uniforms cost 93 B
 *            here even at "linear" defaults — docs/surface-glsl-tracers.md
 *            carries the environment-light and shared-background-shape
 *            history this continues).
 * - balloon: 69242 B (67.6KB) / 17330 B (16.9KB) — past the threshold, so
 *            the size rule strips it (the echo tint had moved it from
 *            68176 B / 17086 B to 69399 B / 17274 B: +1223 B raw, comments
 *            included, and +188 B once stripped — the uniforms and the
 *            shell-gated mix are the only bytes that survive the strip).
 * - plane:   70527 B (68.9KB) / 18215 B (17.8KB) — plane variants always
 *            strip.
 * - finish:  +699 B raw over each of the three (the finishShade body and
 *            the fetch, less the fixed formula they replace); the plain
 *            arm stays unstripped at 63464 B (2072 B of headroom, this
 *            file's tightest), balloon 18113 B and plane 18998 B emitted.
 *
 * ONLY THE RAW SIDE MOVES ON A COMMENT-ONLY EDIT: the strip deletes
 * comments anyway, so balloon's and plane's driver figures are invariant
 * under one, and `off` — the row that never strips — is the only one whose
 * driver bytes such an edit can reach at all.
 *
 * A single monolithic source carrying both arms would be ~76,600 B and every
 * 4D surface session — balloon or not, floor or not — would pay for it,
 * for the first time putting this tracer in the band where the 3D fold
 * program takes 25 seconds to link. Resolved per variant instead, OFF
 * keeps its shipped bytes exactly and each arm pays only for itself.
 *
 * `finish` is the per-map lighting arm ({@link setSurface4Materials}): it
 * threads to the 3D resolver's own
 * `finish` slot, composes with both scene arms, and at 0 resolves
 * byte-identical to the pre-finish build. Its sizes — the one arm that
 * moves the plain 4D source, since the shading site is shared — are in
 * `docs/surface-glsl-tracers.md`'s table.
 */
export function surface4FragmentFor(
  balloon = 0,
  plane = 0,
  finish = 0,
  pattern = 0,
): string {
  return surfaceFragmentFor(
    0,
    0,
    balloon,
    plane,
    0,
    finish,
    pattern,
    SURFACE4_FRAGMENT,
  );
}

/**
 * {@link surface4FragmentFor}'s resolved-but-unstripped twin — reuses
 * {@link surfaceFragmentResolvedFor} rather than restating it, so there is
 * one definition of what a variant arm means across both dimensions.
 */
export function surface4FragmentResolvedFor(
  balloon = 0,
  plane = 0,
  finish = 0,
  pattern = 0,
): string {
  return surfaceFragmentResolvedFor(
    0,
    0,
    balloon,
    plane,
    0,
    finish,
    pattern,
    SURFACE4_FRAGMENT,
  );
}

/** CPU mirror of the `SurfaceMaps4` std140 block — the six Float32Arrays
 * the renderer uploads verbatim, in the SAME ORDER as the block's members
 * in `SURFACE4_FRAGMENT`. Held per material rather than
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
  /** MAX_MAPS * 4 floats: material lane A (specular, shininess,
   * metalness, reflect) — `surfaceMaterialLanes`' order, written by
   * {@link setSurface4Materials}; classic until it runs. */
  readonly finishA: Float32Array;
  /** MAX_MAPS * 4 floats: material lane B (transmit, reflectionTint,
   * patternConfig, scale). */
  readonly finishB: Float32Array;
}

/** The classic+none material's two lanes, derived through `surfaceMaterialLanes`
 * rather than retyped — the 3D material's own constant, restated here
 * because it is module-private there and the two files are twins by
 * convention, not by import of each other's privates. */
const CLASSIC_MATERIAL_LANES = surfaceMaterialLanes(CLASSIC_SURFACE_MATERIAL);

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
    finishA: new Float32Array(SURFACE4_MAX_MAPS * 4),
    finishB: new Float32Array(SURFACE4_MAX_MAPS * 4),
  };
  // Placeholder slots: identity inverse, unit contraction — the same "no
  // system yet" values the pre-block uniform arrays held. Nothing reads them
  // (uMapCount is 0), but a stray zero matrix / zero sigma is the kind of
  // thing that turns a wiring bug into a silent black frame. The finish
  // lanes take the CLASSIC finish for the same reason: a stray
  // SURFACE_FINISH read of an unwritten slot renders the fixed formula's
  // own highlight rather than a matte black one (finishB's zeros ARE the
  // classic B lane).
  for (let j = 0; j < SURFACE4_MAX_MAPS; j++) {
    for (let d = 0; d < 4; d++) buffers.invM[j * 16 + d * 4 + d] = 1;
    buffers.colorSigma[j * 4 + 3] = 1;
    buffers.finishA.set(CLASSIC_MATERIAL_LANES.a, j * 4);
    buffers.finishB.set(CLASSIC_MATERIAL_LANES.b, j * 4);
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
  // The finish pair is a member of this group UNCONDITIONALLY — added here
  // whether or not SURFACE4_FINISH is on, exactly as the block declares it
  // whether or not SURFACE_FINISH is on. A member that came and went with
  // the define would change the std140 offsets three derives from this
  // list on every finish toggle, and a group built for one layout bound to
  // a program compiled for the other is silent offset corruption, not an
  // error. Two dead declarations in the unfinished program and 768 B of
  // the block are the price; the unfinished program's VALUES are untouched.
  maps.add(new THREE.Uniform(buffers.finishA));
  maps.add(new THREE.Uniform(buffers.finishB));
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uMapCount: { value: 0 },
      // No kaleidoscope until a system says otherwise: order 1 + identity
      // is the "no symmetry" encoding, and the sweep never reads the
      // matrix at order 1.
      uSymOrder: { value: 1 },
      uSymStepBack: { value: new THREE.Matrix4() },
      uBoundingRadius: { value: 1 },
      uEscapeRadius: { value: 2 },
      uMaxDepth: { value: 0 },
      uStepScale: { value: 1 },
      uVisibleRadius: { value: 1 },
      uRadiusCenter4: { value: new THREE.Vector4() },
      uRadiusMinD: { value: 0 },
      uRadiusInvRange: { value: 1 },
      uFinalInvM: { value: new THREE.Matrix4() },
      uFinalInvT: { value: new THREE.Vector4() },
      uFinalSigmaMin: { value: 1 },
      uInvRotor: { value: new THREE.Matrix4() },
      uW0: { value: 0 },
      uSliceHalfW: { value: 0 },
      // Balloon inverted-union: inert defaults; alive only under the
      // SURFACE_BALLOON arm (rho 1 so a stray enabled read could never
      // divide by zero). Three.js ignores entries the compiled program
      // does not use, so these stay unconditional.
      uBalloonCenter: { value: new THREE.Vector3() },
      uBalloonR: { value: 0 },
      uBalloonRho: { value: 1 },
      uBalloonFar: { value: 0 },
      // The echo's independent tint: inert default (strength 0) is a
      // bit-exact identity, matching the 3D twin. Packed by the SHARED
      // packSurfaceBalloonTint (surface-material.ts) — this material
      // declares the same uniform names, so no 4D-local pack helper is
      // needed.
      uBalloonTint: { value: new THREE.Vector3() },
      uBalloonTintStrength: { value: 0 },
      // Ground plane: inert defaults; alive only under the
      // SURFACE_GROUND_PLANE arm (ball radius 1 so a stray enabled read
      // could never divide by zero, albedo white so a stray enabled floor
      // is visible rather than a black band).
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
      uBgTop: { value: BG_TOP.clone() },
      uBgBottom: { value: BG_BOTTOM.clone() },
      // Background shape: linear defaults, matching the 3D twin.
      uBgShape: { value: 0 },
      uBgCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uBgScale: { value: new THREE.Vector2(1, 1) },
      uFogDensity: { value: 1 },
      uFogTint: { value: new THREE.Vector3(1, 1, 1) },
      uFogTintStrength: { value: 0 },
      // Environment light: matches state.ts's DEFAULT_SURFACE_ENV_LIGHT.
      uEnvLight: { value: 0.35 },
      // Placeholder; the scene overwrites it per frame with the camera's
      // true angular pixel size.
      uPixelEps: { value: 0.002 },
      uAcceptPixelEps: { value: 0.002 },
      // The pixel CENTRE, the 3D tracer's default: zero here is what
      // makes a single-pass trace value-identical to the
      // pre-supersampling one, and setSurfaceFrameUniforms rewrites it
      // per armed job so no abandoned settle leaks a jitter forward. All
      // four spelled out: THREE.Vector4 defaults w to 1, and w is the
      // dither's y offset in pixels (the 3D tracer's note).
      uPixelJitter: { value: new THREE.Vector4(0, 0, 0, 0) },
      // Full-tier defaults; the scene overwrites all four per tier, same
      // knobs as the 3D tracer.
      uMarchSteps: { value: SURFACE_FULL_MARCH_STEPS },
      uShadowSteps: { value: SURFACE_FULL_SHADOW_STEPS },
      uAoTaps: { value: SURFACE_FULL_AO_TAPS },
      uHitFloor: { value: SURFACE_FULL_HIT_FLOOR },
      uPatternCalibration: { value: new THREE.Vector4() },
    },
    // Which scene arms are compiled in. Like the 3D tracer's variant names
    // these are resolved JS-side ({@link surface4FragmentFor}), so the
    // entries here are change detection and a program-cache key, never
    // driver-parsed text — {@link setSurface4Balloon} and
    // {@link setSurface4GroundPlane} flip them and reassemble the source.
    // Both off is the shipped tracer, byte for byte.
    //
    // THE KEYS DELIBERATELY DO NOT MATCH THE GLSL DIRECTIVES. The `#if`
    // names in SURFACE4_FRAGMENT are the 3D ones (`SURFACE_BALLOON`,
    // `SURFACE_GROUND_PLANE`) because the 3D resolver is what reads them
    // (see surface4FragmentFor: reuse, so there is one definition of what
    // an arm directive means); these SURFACE4_-prefixed keys are this
    // material's own state, and three.js prepends them as inert defines
    // over a source whose arms are already resolved. Renaming the
    // directives to match would break the resolution. SURFACE4_FINISH is
    // the third key under the same rule (its directive is the 3D
    // `SURFACE_FINISH`; setSurface4Materials flips it). SURFACE4_PATTERN is
    // added only while live so the legacy define set stays exact.
    defines: {
      SURFACE4_BALLOON: 0,
      SURFACE4_GROUND_PLANE: 0,
      SURFACE4_FINISH: 0,
    },
    vertexShader: SURFACE4_VERTEX,
    // All arms off resolves to SURFACE4_FRAGMENT verbatim (62765 B, under
    // the 64KB strip threshold), so a plain 4D session hands the driver
    // exactly the source it did before the balloon and floor lifts (plus
    // the envTint term, the shared backgroundShapeT splice, and the finish
    // lanes' two unconditional block members).
    fragmentShader: surface4FragmentFor(),
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
  // The kaleidoscope sweep: always written, like the lens reset below —
  // order 1 (whose matrix the sweep never reads) is the "no kaleidoscope"
  // encoding, so a previous system's sectors never leak. Matrix4.set takes
  // row-major arguments and stores column-major internally, exactly the
  // uFinalInvM convention above.
  u.uSymOrder.value = de.symmetry.order;
  const sb = de.symmetry.stepBack;
  (u.uSymStepBack.value as THREE.Matrix4).set(
    sb[0],
    sb[1],
    sb[2],
    sb[3],
    sb[4],
    sb[5],
    sb[6],
    sb[7],
    sb[8],
    sb[9],
    sb[10],
    sb[11],
    sb[12],
    sb[13],
    sb[14],
    sb[15],
  );
  u.uBoundingRadius.value = de.boundingRadius;
  u.uEscapeRadius.value = de.escapeRadius;
  u.uMaxDepth.value = de.maxDepth;
  u.uStepScale.value = de.stepScale;
  u.uVisibleRadius.value = de.visibleBoundingRadius;
  // Radius-ramp band: minD + 1/range via the core's ONE inverse-range
  // definition, shared with the WGSL packer so the two tracers map the band
  // identically.
  const band = de.radiusBand;
  (u.uRadiusCenter4.value as THREE.Vector4).set(
    band.center[0],
    band.center[1],
    band.center[2],
    band.center[3],
  );
  u.uRadiusMinD.value = band.minD;
  u.uRadiusInvRange.value = radiusBandInvRange(band);
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
 * inverse is exactly its transpose — so `uInvRotor` is set from the SAME
 * 16 numbers with rows and columns swapped (a column-reordered
 * `Matrix4.set`, since `set` itself always fills row-major). `w0` is the
 * marched slice's w-coordinate, uploaded verbatim, and `sliceHalfW` its
 * HALF-THICKNESS in the same units and the same frame: 0 marches the
 * zero-thickness hyperplane this tracer shipped with, value for value, and
 * anything above turns every descent query into the segment the slab cuts
 * over its point (see `uSliceHalfW`'s declaration). Both ride the same
 * call because they describe one hyperslab and `scene.ts` derives them
 * from one slider position. No dirty-check here: like
 * {@link setSurfaceSystem4}, this is a
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

/**
 * Enable (`spec`) or disable (`null`) the balloon inverted-union wrapper
 * (the 4D half of the 3D balloon arm): the scene becomes `min(DE(p),
 * (|p−c|/rho) · DE(I(p)))` over this tracer's beam descent, mirroring
 * `fractal/balloon-de.ts`'s `estimateBalloonDistance`.
 *
 * The payload is the 3D {@link SurfaceBalloonSpec}, IMPORTED rather than
 * restated: `I` is a plain 3D inversion of the marched point (the module
 * doc's slice-then-invert decision), so `center`, `rho`, `R` and `far` mean
 * exactly what they mean one dimension down, and a second copy of that
 * vocabulary is how one renderer starts drawing a different shell from the
 * same document. What the CALLER owes 4D is the ball those numbers come
 * from: the ORIGIN and the FULL 4D visible radius, not a probe-fit centre
 * (there is none in 4D) and not the slice-adjusted radius (which would move
 * the shell under the slice slider) — see the module doc.
 *
 * Flipping the flag reassembles the fragment source through
 * {@link surface4FragmentFor}; a call that changes only the uniforms — the
 * radius slider's per-drag-tick path — never touches the shader. The
 * balloon is SENIOR to the ground plane: turning it on drops the plane arm
 * here (no horizon inside the shell), and the caller re-asserts its stored
 * floor intent after the toggle, exactly as 3D's does.
 */
export function setSurface4Balloon(
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
    // Zeros are fine while the arm is off (the compiled program has no
    // balloon code to read them) — except rho, whose 1 keeps even a stray
    // enabled read divide-by-zero-free, matching createSurfaceMaterial4's
    // inert defaults.
    center.set(0, 0, 0);
    u.uBalloonR.value = 0;
    u.uBalloonRho.value = 1;
    u.uBalloonFar.value = 0;
  }
  const want = spec ? 1 : 0;
  if (material.defines.SURFACE4_BALLOON !== want) {
    const plane =
      want === 1 ? 0 : material.defines.SURFACE4_GROUND_PLANE === 1 ? 1 : 0;
    material.defines.SURFACE4_BALLOON = want;
    material.defines.SURFACE4_GROUND_PLANE = plane;
    // The finish is orthogonal state its own setter owns — preserved
    // through the rebuild, as in 3D.
    material.fragmentShader = surface4FragmentFor(
      want,
      plane,
      material.defines.SURFACE4_FINISH === 1 ? 1 : 0,
      material.defines.SURFACE4_PATTERN === 1 ? 1 : 0,
    );
    material.needsUpdate = true;
  }
}

/**
 * Enable (`spec`) or disable (`null`) the ground plane (the 4D half of the
 * 3D floor arm): an infinite one-sided floor below the session ball that
 * rays MISSING the fractal intersect analytically and shade with the hit
 * path's penumbra shadow + AO + fog, fading radially into the backdrop.
 * Budget-EXHAUSTED rays never reach it — their geometry is unresolved, so
 * they stay backdrop (the WGSL march kernel's status split, which the 4D
 * `main()` grew for this arm).
 *
 * The payload is the 3D {@link SurfaceGroundPlaneSpec}, imported for the
 * same reason the balloon's is: the floor lives in the sliced 3D world
 * space, so every quantity in it is dimension-free. Flipping the flag
 * reassembles the source through {@link surface4FragmentFor}, which strips
 * comments and indentation from every plane variant.
 *
 * THROWS if asked to enable over the balloon — there is no horizon inside
 * the shell — and it throws BEFORE any state moves, so a caller that gets
 * the gate wrong is left with the material it had rather than a define and
 * a shader that disagree.
 */
export function setSurface4GroundPlane(
  material: THREE.ShaderMaterial,
  spec: SurfaceGroundPlaneSpec | null,
): void {
  const want = spec ? 1 : 0;
  // Assembled first, and only when the arm actually moves: this is where
  // the plane-over-balloon refusal lives (surfaceFragmentFor's own
  // RangeError), and nothing below it may run if it fires.
  const fragment =
    material.defines.SURFACE4_GROUND_PLANE === want
      ? null
      : surface4FragmentFor(
          material.defines.SURFACE4_BALLOON === 1 ? 1 : 0,
          want,
          material.defines.SURFACE4_FINISH === 1 ? 1 : 0,
          material.defines.SURFACE4_PATTERN === 1 ? 1 : 0,
        );
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
    // Zeros are fine while the arm is off — except the ball radius, whose
    // 1 keeps even a stray enabled read divide-by-zero-free, matching
    // createSurfaceMaterial4's inert defaults.
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
  if (fragment !== null) {
    material.defines.SURFACE4_GROUND_PLANE = want;
    material.fragmentShader = fragment;
    material.needsUpdate = true;
  }
}

/**
 * Install the unified per-map A/B material wire, keyed exactly as
 * `setSurfaceSystem4`'s `colors[j]`, or clear it with `null`. The 3D
 * `setSurfaceMaterials` contract one dimension up: THE CALLER OWNS THE
 * BYTE-IDENTITY GATE and passes `null` for classic+none. A patterned wire
 * carries its one per-DE calibration quartet; finish and pattern compile
 * independently, so pattern-only retains the fixed lighting formula.
 *
 * The lanes land in the std140 block's two trailing members — written
 * through the group's backing arrays like every other per-map quantity,
 * every slot on every call (listed ones to their lanes, the rest and all
 * of them on `null` back to the CLASSIC lanes), so no previous system's
 * material can leak into an unfilled slot. The block members exist whether
 * or not either arm is compiled (see the block and group comments), so
 * writing them never touches the layout; only a define flip reassembles
 * the source, through {@link surface4FragmentFor} with the material's
 * CURRENT scene arms — a session-set-scale rebuild, and a lanes-only call
 * (a finish or pattern slider's per-drag tick) never touches the shader. Throws past
 * {@link SURFACE4_MAX_MAPS} slots.
 */
export function setSurface4Materials(
  material: THREE.ShaderMaterial,
  materials: SurfaceMaterialSlots | null,
): void {
  if (materials && materials.slots.length > SURFACE4_MAX_MAPS) {
    throw new RangeError(
      `${materials.slots.length} surface materials, but the material carries at most ${SURFACE4_MAX_MAPS}`,
    );
  }
  const maps = mapBuffers.get(material);
  if (!maps) {
    throw new TypeError(
      "surface material 4D has no map block — build it with createSurfaceMaterial4",
    );
  }
  for (let j = 0; j < SURFACE4_MAX_MAPS; j++) {
    const lanes =
      materials && j < materials.slots.length
        ? surfaceMaterialLanes(materials.slots[j])
        : CLASSIC_MATERIAL_LANES;
    maps.finishA.set(lanes.a, j * 4);
    maps.finishB.set(lanes.b, j * 4);
  }
  const calibration = material.uniforms.uPatternCalibration
    .value as THREE.Vector4;
  if (materials?.pattern) {
    const c = materials.patternCalibration;
    calibration.set(c.ringsLow, c.ringsInvSpan, c.sheetsLow, c.sheetsInvSpan);
  } else {
    calibration.set(0, 0, 0, 0);
  }
  const wantFinish = materials?.finish ? 1 : 0;
  const wantPattern = materials?.pattern ? 1 : 0;
  const currentPattern = material.defines.SURFACE4_PATTERN === 1 ? 1 : 0;
  if (
    material.defines.SURFACE4_FINISH !== wantFinish ||
    currentPattern !== wantPattern
  ) {
    material.defines.SURFACE4_FINISH = wantFinish;
    if (wantPattern) material.defines.SURFACE4_PATTERN = 1;
    else delete material.defines.SURFACE4_PATTERN;
    material.fragmentShader = surface4FragmentFor(
      material.defines.SURFACE4_BALLOON === 1 ? 1 : 0,
      material.defines.SURFACE4_GROUND_PLANE === 1 ? 1 : 0,
      wantFinish,
      wantPattern,
    );
    material.needsUpdate = true;
  }
}
