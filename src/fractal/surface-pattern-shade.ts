import { CLASSIC_SURFACE_FINISH } from "./surface-finish";
import {
  PATTERN_DEFAULT_SCALE,
  PATTERN_DETAIL_FOOTPRINT_FULL,
  PATTERN_DETAIL_FOOTPRINT_OFF,
  PATTERN_DETAIL_MAX_OCTAVE,
  PATTERN_DETAIL_SCALE_MULTIPLIER,
  PATTERN_NATIVE_WARP_CYCLES,
  PATTERN_NOISE_OCTAVES,
  type PatternQuery,
  type ResolvedSurfacePattern,
} from "./surface-pattern";
import {
  SURFACE_PATTERN_WIRE_AXIS_RADIX,
  SURFACE_PATTERN_WIRE_KIND_RADIX,
  SURFACE_PATTERN_WIRE_STRENGTH_STEPS,
  surfaceMaterialLanes,
} from "./surface-material-wire";
import type { Vec3 } from "./types";

/**
 * The SURFACE_PATTERN shading arm's ONE shared body — emitted in both
 * shader dialects — and its TS mirror.
 *
 * The accepted V3 pattern arithmetic (surface-pattern.ts) is a pure function
 * of (base albedo, normalized source point, patternConfig, scale, sheets
 * carrier, calibration, pixel footprint). This module owns:
 *
 * - {@link surfacePatternShadeSource}, the emitted GLSL both GLSL tracers
 *   (surface-material.ts and surface-material-4d.ts) splice under their own
 *   `#if SURFACE_PATTERN` arms, and
 *   {@link surfacePatternShadeSourceWgsl}, the WGSL twin the shared WGSL
 *   shade kernel (surface-de-gpu.ts) splices under its `pattern` codegen
 *   flag. ONE body template ({@link surfacePatternBody}) emits both through
 *   the {@link SurfacePatternShadeDialect} spellings — the
 *   `surface-finish.ts` `SurfaceFinishDialect` discipline — so the two GLSL
 *   tracers and the WGSL kernel cannot drift on the arithmetic. The two GLSL
 *   tracers differ only in how they RECONSTRUCT and NORMALIZE the source
 *   hit; everything from the config decode through the macro ramps, the
 *   scale-stable detail octave, and the albedo factor is this module's
 *   single emission.
 * - {@link patternShadeTs}, the TS mirror of the emitted body, executing the
 *   same operation order with f32 rounding at the decode and mix boundaries
 *   the wire contract makes exact — the executable stand-in for the shaders
 *   the parity tests compare against the double-precision oracle
 *   `evaluateSurfacePattern`. The mirror is written as a transliteration of
 *   the GLSL text (not a re-derivation of the oracle), so a porting error in
 *   the emission — wrong constant, wrong axis lane, wrong operation order —
 *   shows up as a value mismatch here rather than only as a missed byte pin.
 *
 * The GLSL body is emitted as GLSL3 (300 es) text: `uint` bit arithmetic for
 * the integer-lattice hash (well-defined modulo-2^32 wrapping, matching the
 * TS oracle's `| 0`/`imul` bit patterns exactly), `exp2` for dyadic octave
 * scaling, and GLSL's `mix`/`smoothstep`/`fract` builtins (identical
 * definitions to the oracle's helpers on every edge the body uses). WGSL
 * spells the same operations with its own names (`select` for a bool-picked
 * value, `let`/`var` plus an explicit type for every local), and the two
 * texts collapse onto one character stream under the test's canon function —
 * the same proof surface-finish.ts's body-equality test gives its own pair.
 */

/** The per-dialect spellings {@link surfacePatternBody} interpolates —
 * `surface-finish.ts`'s `SurfaceFinishDialect` pattern applied to the
 * pattern math. GLSL spells every local with its type; WGSL declares with
 * `let`/`var` PLUS an explicit type annotation, so the two texts become
 * identical under the test's canonicalization and the arithmetic cannot
 * drift between the two GLSL tracers and the WGSL shade kernel. */
export interface SurfacePatternShadeDialect {
  readonly language: "glsl" | "wgsl";
  /** The constructor-and-type spelling: `vec2` / `vec2f`. */
  readonly vec2: string;
  readonly vec3: string;
  /** `uint(int(x))` / `u32(i32(x))` — the integer-lattice hash's casts. */
  readonly cu2: (e: string) => string;
  /** `float(x)` / `f32(x)`. */
  readonly cf: (e: string) => string;
  /** `int(x)` / `i32(x)`. */
  readonly ci: (e: string) => string;
  /** A bool-picked value: `cond ? a : b` / `select(b, a, cond)` — both
   * dialects select `b` when the condition is false and `a` when true. */
  readonly sel: (a: string, b: string, cond: string) => string;
  /** Immutable scalar locals: `float x = ...;` / `let x: f32 = ...;`. */
  readonly f: (name: string, init: string) => string;
  /** Immutable bool locals: `bool x = ...;` / `let x: bool = ...;`. */
  readonly b: (name: string, init: string) => string;
  /** Immutable vec3 locals: `vec3 x = ...;` / `let x: vec3f = ...;`. */
  readonly v3: (name: string, init: string) => string;
  /** Mutable f32 locals (the fbm accumulators): `float x = ...;` /
   * `var x: f32 = ...;`. */
  readonly fVar: (name: string, init: string) => string;
  /** Mutable u32 locals (the hash's h): `uint h = ...;` / `var h: u32 = ...;`. */
  readonly u32Var: (name: string, init: string) => string;
  /** Mutable vec3 locals (the detail-warp copy): `vec3 x = ...;` /
   * `var x: vec3f = ...;`. */
  readonly v3Var: (name: string, init: string) => string;
  /** Immutable i32 locals (the decoded kind/axis/level): `int x = ...;` /
   * `let x: i32 = ...;`. */
  readonly i32Let: (name: string, init: string) => string;
  /** The fbm loop's induction declaration: `int octave = 0` /
   * `var octave: i32 = 0`. */
  readonly loopI: (init: string) => string;
  /** A function signature, spelled per dialect. */
  readonly sig: (glsl: string, wgsl: string) => string;
}

export const SURFACE_PATTERN_SHADE_GLSL: SurfacePatternShadeDialect = {
  language: "glsl",
  vec2: "vec2",
  vec3: "vec3",
  cu2: (e) => `uint(int(${e}))`,
  cf: (e) => `float(${e})`,
  ci: (e) => `int(${e})`,
  sel: (a, b, cond) => `${cond} ? ${a} : ${b}`,
  f: (name, init) => `float ${name} = ${init};`,
  b: (name, init) => `bool ${name} = ${init};`,
  v3: (name, init) => `vec3 ${name} = ${init};`,
  fVar: (name, init) => `float ${name} = ${init};`,
  u32Var: (name, init) => `uint ${name} = ${init};`,
  v3Var: (name, init) => `vec3 ${name} = ${init};`,
  i32Let: (name, init) => `int ${name} = ${init};`,
  loopI: (init) => `int ${init} = 0`,
  sig: (glsl) => glsl,
};

export const SURFACE_PATTERN_SHADE_WGSL: SurfacePatternShadeDialect = {
  language: "wgsl",
  vec2: "vec2f",
  vec3: "vec3f",
  cu2: (e) => `u32(i32(${e}))`,
  cf: (e) => `f32(${e})`,
  ci: (e) => `i32(${e})`,
  sel: (a, b, cond) => `select(${b}, ${a}, ${cond})`,
  f: (name, init) => `let ${name}: f32 = ${init};`,
  b: (name, init) => `let ${name}: bool = ${init};`,
  v3: (name, init) => `let ${name}: vec3f = ${init};`,
  fVar: (name, init) => `var ${name}: f32 = ${init};`,
  u32Var: (name, init) => `var ${name}: u32 = ${init};`,
  v3Var: (name, init) => `var ${name}: vec3f = ${init};`,
  i32Let: (name, init) => `let ${name}: i32 = ${init};`,
  loopI: (init) => `var ${init}: i32 = 0`,
  sig: (_glsl, wgsl) => wgsl,
};

/** The ONE pattern-math body template, emitted in both dialects. Reads NO
 * uniforms directly: everything it needs arrives as parameters, so the 3D
 * and 4D GLSL emissions are character-identical and the call site owns the
 * frame-specific reconstruction. The body is written comment-light — the 4D
 * plain arm's strip-threshold headroom is measured in single kilobytes, and
 * the pattern arm lands on every one of those rows. */
function surfacePatternBody(d: SurfacePatternShadeDialect): string {
  const sig = d.sig;
  const f = d.f;
  const b = d.b;
  const v3 = d.v3;
  const v3v = d.v3Var;
  const fv = d.fVar;
  const u32v = d.u32Var;
  const i32l = d.i32Let;
  const V2 = d.vec2;
  const V3 = d.vec3;
  const sel = d.sel;
  const cu2 = d.cu2;
  const cf = d.cf;
  const ci = d.ci;
  return `
  // Shared pattern body — see patternShadeTs in surface-pattern-shade.ts.
${sig(
  "  float patternHash3(float ix, float iy, float iz) {",
  "  fn patternHash3(ix: f32, iy: f32, iz: f32) -> f32 {",
)}
    ${u32v("h", `${cu2("ix")} * 374761393u + ${cu2("iy")} * 668265263u + ${cu2("iz")} * 2147483647u`)}
    h = (h ^ (h >> 13u)) * 1274126177u;
    h ^= h >> 16u;
    return ${cf("h")} / 4294967296.0;
  }

${sig(
  "  float patternValueNoise(vec3 p) {",
  "  fn patternValueNoise(p: vec3f) -> f32 {",
)}
    ${f("ix", "floor(p.x)")}
    ${f("iy", "floor(p.y)")}
    ${f("iz", "floor(p.z)")}
    ${f("fx", "smoothstep(0.0, 1.0, p.x - ix)")}
    ${f("fy", "smoothstep(0.0, 1.0, p.y - iy)")}
    ${f("fz", "smoothstep(0.0, 1.0, p.z - iz)")}
    ${f("c000", "patternHash3(ix, iy, iz) - 0.5")}
    ${f("c100", "patternHash3(ix + 1.0, iy, iz) - 0.5")}
    ${f("c010", "patternHash3(ix, iy + 1.0, iz) - 0.5")}
    ${f("c110", "patternHash3(ix + 1.0, iy + 1.0, iz) - 0.5")}
    ${f("c001", "patternHash3(ix, iy, iz + 1.0) - 0.5")}
    ${f("c101", "patternHash3(ix + 1.0, iy, iz + 1.0) - 0.5")}
    ${f("c011", "patternHash3(ix, iy + 1.0, iz + 1.0) - 0.5")}
    ${f("c111", "patternHash3(ix + 1.0, iy + 1.0, iz + 1.0) - 0.5")}
    return mix(
      mix(mix(c000, c100, fx), mix(c010, c110, fx), fy),
      mix(mix(c001, c101, fx), mix(c011, c111, fx), fy),
      fz
    );
  }

${sig("  float patternFbm(vec3 p) {", "  fn patternFbm(p: vec3f) -> f32 {")}
    ${fv("sum", "0.0")}
    ${fv("amplitude", "0.5")}
    ${fv("total", "0.0")}
    ${fv("frequency", "1.0")}
    for (${d.loopI("octave")}; octave < ${PATTERN_NOISE_OCTAVES}; octave++) {
      sum += amplitude * patternValueNoise(p * frequency);
      total += amplitude;
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return sum / total;
  }

${sig(
  "  vec3 patternPermutePoint(int axisId, vec3 p) {",
  "  fn patternPermutePoint(axisId: i32, p: vec3f) -> vec3f {",
)}
    if (axisId == 0) {
      return ${V3}(p.x, p.y, p.z);
    }
    if (axisId == 2) {
      return ${V3}(p.z, p.x, p.y);
    }
    return ${V3}(p.y, p.x, p.z);
  }

${sig(
  "  float patternWoodRamp(float phase) {",
  "  fn patternWoodRamp(phase: f32) -> f32 {",
)}
    ${f("t", "fract(phase)")}
    ${f("latewood", "smoothstep(0.62, 0.78, t) * (1.0 - smoothstep(0.91, 1.0, t))")}
    ${f("ringLine", "1.0 - smoothstep(0.0, 0.04, min(t, 1.0 - t))")}
    return max(0.72 * latewood, ringLine);
  }

${sig(
  "  float patternStrataRamp(float phase) {",
  "  fn patternStrataRamp(phase: f32) -> f32 {",
)}
    ${f("t", "fract(phase)")}
    ${f("broad", "smoothstep(0.06, 0.16, t) * (1.0 - smoothstep(0.52, 0.66, t))")}
    ${f("seam", "1.0 - smoothstep(0.0, 0.035, abs(t - 0.61))")}
    return max(0.72 * broad, seam);
  }

${sig(
  "  float patternMarbleMacroRamp(float scale, vec3 p, vec3 pm) {",
  "  fn patternMarbleMacroRamp(scale: f32, p: vec3f, pm: vec3f) -> f32 {",
)}
    ${f("safeScale", "max(scale, 0.0)")}
    ${f("qScale", `safeScale / ${PATTERN_DEFAULT_SCALE.marble}`)}
    ${f("qa", "pm.x * qScale")}
    ${f("qu", "pm.y * qScale")}
    ${f("qv", "pm.z * qScale")}
    ${f("plane", "qa + 0.2 * qu - 0.12 * qv")}
    ${f("warpA", `patternFbm(${V3}(p.x * qScale * 1.1 + 1.9, p.y * qScale * 1.1 - 5.2, p.z * qScale * 1.1 + 3.4))`)}
    ${f("warpB", `patternFbm(${V3}(p.z * qScale * 2.1 - 6.4, p.x * qScale * 2.1 + 2.8, p.y * qScale * 2.1 + 9.1))`)}
    ${f("field", "0.34 * plane + warpA - 0.035")}
    ${f("branchField", "0.2 * (0.58 * qa - 0.41 * qu + 0.29 * qv) + 0.7 * warpA + 0.46 * warpB - 0.11")}
    ${f("branchGate", "1.0 - smoothstep(0.075, 0.19, abs(warpA - warpB))")}
    ${f("primaryDistance", "abs(field)")}
    ${f("branchDistance", "abs(branchField)")}
    ${f("core", "max(1.0 - smoothstep(0.018, 0.052, primaryDistance), branchGate * (1.0 - smoothstep(0.014, 0.044, branchDistance)))")}
    ${f("halo", "max(1.0 - smoothstep(0.052, 0.13, primaryDistance), 0.72 * branchGate * (1.0 - smoothstep(0.044, 0.105, branchDistance)))")}
    return clamp(0.58 * halo + 0.42 * core, 0.0, 1.0);
  }

${sig(
  "  float patternMacroRamp(int kindId, float scale, vec3 p, vec3 pm) {",
  "  fn patternMacroRamp(kindId: i32, scale: f32, p: vec3f, pm: vec3f) -> f32 {",
)}
    ${f("safeScale", "max(scale, 0.0)")}
    if (kindId == 1) {
      ${f("radial", `length(${V2}(pm.y, pm.z))`)}
      ${f("wobble", `patternFbm(${V3}(pm.y * 1.25 + 0.7, pm.x * 0.22 - 2.3, pm.z * 1.25 + 4.7))`)}
      ${f("axialGrain", `patternFbm(${V3}(pm.y * 3.0 + 8.0, pm.x * 0.35 - 4.0, pm.z * 3.0 - 6.0))`)}
      ${f("phase", "(radial + 0.1 * wobble + 0.025 * axialGrain) * safeScale")}
      return patternWoodRamp(phase);
    }
    if (kindId == 2) {
      return patternMarbleMacroRamp(scale, p, pm);
    }
    ${f("warp", `patternFbm(${V3}(pm.y * 0.6 - 4.3, pm.x * 0.2 + 8.1, pm.z * 0.6 + 2.7))`)}
    ${f("phase", "(pm.x + 0.055 * warp) * safeScale")}
    return patternStrataRamp(phase);
  }

${sig(
  "  vec3 patternDetailWarpPoint(int kindId, float detailScale, vec3 pm, float nativeValue, bool nativeEnabled) {",
  "  fn patternDetailWarpPoint(kindId: i32, detailScale: f32, pm: vec3f, nativeValue: f32, nativeEnabled: bool) -> vec3f {",
)}
    if (!nativeEnabled || detailScale <= 0.0) {
      return pm;
    }
    ${f("warpCycles", sel(`${PATTERN_NATIVE_WARP_CYCLES.marble}`, `${PATTERN_NATIVE_WARP_CYCLES.wood}`, "kindId == 2"))}
    ${f("shift", "((nativeValue - 0.5) * warpCycles) / detailScale")}
    ${v3v("warped", "pm")}
    if (kindId == 1) {
      warped.y += shift;
    } else {
      warped.x += shift;
    }
    return warped;
  }

${sig(
  "  float patternMarbleDetailRamp(float scale, vec3 p, vec3 pm) {",
  "  fn patternMarbleDetailRamp(scale: f32, p: vec3f, pm: vec3f) -> f32 {",
)}
    ${f("safeScale", "max(scale, 0.0)")}
    ${f("warp", `patternFbm(${V3}(pm.y * safeScale * 0.28 + 3.7, pm.x * safeScale * 0.2 - 6.1, pm.z * safeScale * 0.28 + 1.9))`)}
    ${f("warpB", `patternFbm(${V3}(pm.z * safeScale * 0.24 - 4.8, pm.y * safeScale * 0.18 + 2.6, pm.x * safeScale * 0.24 + 7.3))`)}
    ${f("phase", "(pm.x + 0.18 * pm.y - 0.11 * pm.z) * safeScale + 0.42 * warp")}
    ${f("branchPhase", "(0.62 * pm.x - 0.47 * pm.y + 0.31 * pm.z) * safeScale * 0.78 + 0.48 * warpB + 1.37")}
    ${f("veinCore", "1.0 - smoothstep(0.018, 0.055, abs(fract(phase) - 0.5))")}
    ${f("veinHalo", "1.0 - smoothstep(0.055, 0.2, abs(fract(phase) - 0.5))")}
    ${f("vein", "clamp(0.58 * veinHalo + 0.42 * veinCore, 0.0, 1.0)")}
    ${f("branchCore", "1.0 - smoothstep(0.018, 0.055, abs(fract(branchPhase) - 0.5))")}
    ${f("branchHalo", "1.0 - smoothstep(0.055, 0.2, abs(fract(branchPhase) - 0.5))")}
    ${f("branchVein", "clamp(0.58 * branchHalo + 0.42 * branchCore, 0.0, 1.0)")}
    ${f("cloud", "0.1 + 0.42 * clamp(warp + 0.5, 0.0, 1.0)")}
    ${f("branchGate", "smoothstep(-0.04, 0.22, warp - 0.45 * warpB)")}
    ${f("branch", "0.82 * branchGate * branchVein")}
    ${f("ramp", "max(cloud, max(vein, branch))")}
    return clamp(0.5 + (ramp - 0.5) * 2.25, 0.0, 1.0);
  }

${sig(
  "  float patternMaterialDetailRamp(int kindId, float scale, vec3 p, vec3 pm) {",
  "  fn patternMaterialDetailRamp(kindId: i32, scale: f32, p: vec3f, pm: vec3f) -> f32 {",
)}
    if (kindId == 2) {
      return patternMarbleDetailRamp(scale, p, pm);
    }
    return patternMacroRamp(kindId, scale, p, pm);
  }

${sig(
  "  float patternVarianceRampMix(float a, float b, float t) {",
  "  fn patternVarianceRampMix(a: f32, b: f32, t: f32) -> f32 {",
)}
    ${f("mixed", "mix(a, b, t)")}
    ${f("gain", "1.0 / sqrt((1.0 - t) * (1.0 - t) + t * t)")}
    return clamp(0.5 + (mixed - 0.5) * gain, 0.0, 1.0);
  }

${sig(
  "  float patternScaleStableDetailRamp(int kindId, float scale, vec3 p, vec3 pm, float nativeValue, bool nativeEnabled, float pixelFootprint) {",
  "  fn patternScaleStableDetailRamp(kindId: i32, scale: f32, p: vec3f, pm: vec3f, nativeValue: f32, nativeEnabled: bool, pixelFootprint: f32) -> f32 {",
)}
    ${f("footprint", "max(pixelFootprint, 1.0e-9)")}
    ${f("detailScaleMult", sel(`${PATTERN_DETAIL_SCALE_MULTIPLIER.marble}`, `${PATTERN_DETAIL_SCALE_MULTIPLIER.wood}.0`, "kindId == 2"))}
    ${f("desired", `max(1.0, (detailScaleMult * ${PATTERN_DETAIL_FOOTPRINT_OFF}) / footprint)`)}
    ${f("rawLevel", "log2(desired)")}
    ${f("levelF", `clamp(floor(rawLevel), 0.0, ${PATTERN_DETAIL_MAX_OCTAVE}.0)`)}
    ${i32l("level", ci("levelF"))}
    ${f("blend", "smoothstep(0.0, 1.0, clamp(rawLevel - levelF, 0.0, 1.0))")}
    ${f("lowScale", "scale * exp2(levelF)")}
    ${v3("lowP", "patternDetailWarpPoint(kindId, lowScale, pm, nativeValue, nativeEnabled)")}
    ${f("low", "patternMaterialDetailRamp(kindId, lowScale, p, lowP)")}
    if (level >= ${PATTERN_DETAIL_MAX_OCTAVE}) {
      return low;
    }
    ${f("highScale", "scale * exp2(levelF + 1.0)")}
    ${v3("highP", "patternDetailWarpPoint(kindId, highScale, pm, nativeValue, nativeEnabled)")}
    ${f("high", "patternMaterialDetailRamp(kindId, highScale, p, highP)")}
    return patternVarianceRampMix(low, high, blend);
  }

${sig(
  "  float patternDetailGate(float pixelFootprint) {",
  "  fn patternDetailGate(pixelFootprint: f32) -> f32 {",
)}
    return 1.0 - smoothstep(${PATTERN_DETAIL_FOOTPRINT_FULL}, ${PATTERN_DETAIL_FOOTPRINT_OFF}, pixelFootprint);
  }

${sig(
  "  vec3 patternAlbedo(vec3 base, int kindId, float ramp) {",
  "  fn patternAlbedo(base: vec3f, kindId: i32, ramp: f32) -> vec3f {",
)}
    if (kindId == 1) {
      ${v3("early", `${V3}(1.06, 1.03, 0.92)`)}
      ${v3("late", `${V3}(0.3, 0.22, 0.16)`)}
      ${f("amount", "smoothstep(0.04, 0.92, ramp)")}
      ${v3("factor", "mix(early, late, amount)")}
      return clamp(base * factor, ${V3}(0.0), ${V3}(1.0));
    }
    if (kindId == 2) {
      ${v3("halo", `${V3}(0.8, 0.78, 0.76)`)}
      ${v3("core", `${V3}(0.4, 0.43, 0.49)`)}
      ${f("haloAmount", "smoothstep(0.02, 0.58, ramp)")}
      ${f("coreAmount", "smoothstep(0.58, 1.0, ramp)")}
      ${v3("factor", `mix(mix(${V3}(1.0), halo, haloAmount), core, coreAmount)`)}
      return clamp(base * factor, ${V3}(0.0), ${V3}(1.0));
    }
    ${v3("bed", `${V3}(0.58, 0.62, 0.68)`)}
    ${v3("seam", `${V3}(0.38, 0.24, 0.16)`)}
    ${f("bedAmount", "smoothstep(0.02, 0.72, ramp)")}
    ${f("seamAmount", "smoothstep(0.74, 1.0, ramp)")}
    ${v3("factor", `mix(mix(${V3}(1.0), bed, bedAmount), seam, seamAmount)`)}
    return clamp(base * factor, ${V3}(0.0), ${V3}(1.0));
  }

${sig(
  "  vec3 patternShade(vec3 base, vec3 objectP, vec4 fb, vec4 calibration, float sheets, float pixelFootprint) {",
  "  fn patternShade(base: vec3f, objectP: vec3f, fb: vec4f, calibration: vec4f, sheets: f32, pixelFootprint: f32) -> vec3f {",
)}
    ${f("word", "fb.z")}
    if (word == 0.0) {
      return base;
    }
    ${f("kindDiv", `floor(word / ${SURFACE_PATTERN_WIRE_KIND_RADIX}.0)`)}
    ${i32l("kindId", ci("kindDiv"))}
    if (kindId < 1 || kindId > 3) {
      return base;
    }
    ${f("kindBase", `kindDiv * ${SURFACE_PATTERN_WIRE_KIND_RADIX}.0`)}
    ${f("axisDiv", `floor((word - kindBase) / ${SURFACE_PATTERN_WIRE_AXIS_RADIX}.0)`)}
    ${i32l("axisId", ci("axisDiv"))}
    ${f("strengthQ", `word - kindBase - axisDiv * ${SURFACE_PATTERN_WIRE_AXIS_RADIX}.0`)}
    ${f("strength", `strengthQ / ${SURFACE_PATTERN_WIRE_STRENGTH_STEPS}.0`)}
    ${f("scale", "fb.w")}
    ${v3("pm", "patternPermutePoint(axisId, objectP)")}
    ${f("macroRamp", "patternMacroRamp(kindId, scale, objectP, pm)")}
    ${b("nativeEnabled", "calibration.w != 0.0")}
    ${f("nativeValue", "clamp((sheets - calibration.z) * calibration.w, 0.0, 1.0)")}
    ${f("detail", "patternScaleStableDetailRamp(kindId, scale, objectP, pm, nativeValue, nativeEnabled, pixelFootprint)")}
    ${f("gate", sel("patternDetailGate(pixelFootprint)", "0.0", "nativeEnabled"))}
    ${f("outputRamp", "mix(macroRamp, detail, gate)")}
    ${v3("full", "patternAlbedo(base, kindId, outputRamp)")}
    return mix(base, full, clamp(strength, 0.0, 1.0));
  }
`;
}

/** The GLSL3 emission of {@link surfacePatternBody} — the body both GLSL
 * tracers splice under their own `#if SURFACE_PATTERN` arms. One body, so
 * the 3D and 4D formula copies cannot drift; the two tracers differ only in
 * the call site's frame reconstruction. */
export function surfacePatternShadeSource(): string {
  return surfacePatternBody(SURFACE_PATTERN_SHADE_GLSL);
}

/** The WGSL emission of {@link surfacePatternBody} — the twin
 * `surface-de-gpu.ts`'s shade kernel splices under its `pattern` codegen
 * flag. Same math, per-dialect spelling; the body-equality test pins the
 * two emissions to one canonical text. */
export function surfacePatternShadeSourceWgsl(): string {
  return surfacePatternBody(SURFACE_PATTERN_SHADE_WGSL);
}

/**
 * The TS mirror of the emitted `patternShade` body — the value-level
 * transcript of what the GLSL computes, executed in double with f32 rounding
 * at the decode and mix boundaries the wire contract makes exact. Signature
 * mirrors the GLSL's parameter list: `fb` is the packed B lane (fb.z =
 * patternConfig, fb.w = scale), `calibration` is `(ringsLow, ringsInvSpan,
 * sheetsLow, sheetsInvSpan)`.
 *
 * THE ROUNDING DISCIPLINE, honestly: the mirror rounds at the f32-exact
 * CONTRACT boundaries — the wire decode (`word`, `kindDiv`, `strengthQ`,
 * `strength`, `scale`) and the final albedo mix — and computes the ramp
 * chain in double. The double oracle and this mirror therefore agree to far
 * tighter than f32 ulp wherever the ramp is smooth; the parity tests compare
 * against `evaluateSurfacePattern` and use tolerances sized for the two
 * places f32 really differs: the quantized strength field (<= 0.00005) and
 * the integer-lattice hash's final division. A transcription error (wrong
 * constant, wrong axis lane, wrong order) lands orders of magnitude above
 * either and fails the same test.
 */
export function patternShadeTs(
  base: Vec3,
  objectP: Vec3,
  fb: [number, number, number, number],
  calibration: [number, number, number, number],
  sheets: number,
  pixelFootprint: number,
): Vec3 {
  const f = Math.fround;
  const word = f(fb[2]);
  if (word === 0) return base;
  const kindDiv = f(Math.floor(word / SURFACE_PATTERN_WIRE_KIND_RADIX));
  const kindId = Math.trunc(kindDiv);
  if (kindId < 1 || kindId > 3) return base;
  const kindBase = f(kindDiv * SURFACE_PATTERN_WIRE_KIND_RADIX);
  const axisDiv = f(
    Math.floor(f(word - kindBase) / SURFACE_PATTERN_WIRE_AXIS_RADIX),
  );
  const axisId = Math.trunc(axisDiv);
  const strengthQ = f(
    word - kindBase - axisDiv * SURFACE_PATTERN_WIRE_AXIS_RADIX,
  );
  const strength = f(strengthQ / SURFACE_PATTERN_WIRE_STRENGTH_STEPS);
  const scale = f(fb[3]);

  const pm = patternPermuteTs(axisId, objectP);
  const macroRamp = f(patternMacroRampTs(kindId, scale, objectP, pm));
  const nativeEnabled = calibration[3] !== 0;
  const nativeValue = f(clamp01(f((sheets - calibration[2]) * calibration[3])));
  const detail = patternScaleStableDetailRampTs(
    kindId,
    scale,
    objectP,
    pm,
    nativeValue,
    nativeEnabled,
    pixelFootprint,
  );
  const gate = nativeEnabled ? patternDetailGateTs(pixelFootprint) : 0;
  const outputRamp = f(mixF(macroRamp, detail, gate));
  const full = patternAlbedoTs(base, kindId, outputRamp);
  const strengthC = clamp01(strength);
  // Strength 0 is an exact albedo identity in f32 too: GLSL mix(a, b, 0.0)
  // is a*1.0 + b*0.0 == a, and the oracle's own identity contract pins the
  // same equality — so the mirror returns base untouched rather than
  // re-rounding it.
  if (strengthC === 0) return base;
  return [
    f(mixF(base[0], full[0], strengthC)),
    f(mixF(base[1], full[1], strengthC)),
    f(mixF(base[2], full[2], strengthC)),
  ];
}

/** The packed B lane `(transmit, reflectionTint, config, scale)` the GLSL
 * `patternShade` reads, from a resolved pattern — the wire's own packer, so
 * mirror fixtures feed the same f32-exact word the shader receives. */
export function patternLaneFor(
  pattern: ResolvedSurfacePattern,
): [number, number, number, number] {
  const lanes = surfaceMaterialLanes({
    finish: CLASSIC_SURFACE_FINISH,
    pattern,
  });
  return [...lanes.b] as [number, number, number, number];
}

/** The pattern query the GLSL call site reconstructs — the mirror's input
 * vocabulary, shared with the parity tests. */
export interface PatternShadeQuery {
  objectP: Vec3;
  sheets: number;
  calibration: [number, number, number, number];
  pixelFootprint: number;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const mixF = (a: number, b: number, t: number): number =>
  Math.fround(a * (1 - t) + b * t);
const smoothstepTs = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function patternPermuteTs(axisId: number, p: Vec3): Vec3 {
  if (axisId === 0) return [p[0], p[1], p[2]];
  if (axisId === 2) return [p[2], p[0], p[1]];
  return [p[1], p[0], p[2]];
}

/** Integer-lattice hash to [0, 1) — the oracle's own hash3, whose bit
 * pattern the GLSL uint body reproduces exactly. */
function hash3(ix: number, iy: number, iz: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoiseTs(p: Vec3): number {
  const ix = Math.floor(p[0]);
  const iy = Math.floor(p[1]);
  const iz = Math.floor(p[2]);
  const fx = smoothstepTs(0, 1, p[0] - ix);
  const fy = smoothstepTs(0, 1, p[1] - iy);
  const fz = smoothstepTs(0, 1, p[2] - iz);
  const c = (dx: number, dy: number, dz: number): number =>
    hash3(ix + dx, iy + dy, iz + dz) - 0.5;
  return mixF(
    mixF(
      mixF(c(0, 0, 0), c(1, 0, 0), fx),
      mixF(c(0, 1, 0), c(1, 1, 0), fx),
      fy,
    ),
    mixF(
      mixF(c(0, 0, 1), c(1, 0, 1), fx),
      mixF(c(0, 1, 1), c(1, 1, 1), fx),
      fy,
    ),
    fz,
  );
}

function fbmTs(p: Vec3): number {
  let sum = 0;
  let amplitude = 0.5;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < PATTERN_NOISE_OCTAVES; octave++) {
    sum +=
      amplitude *
      valueNoiseTs([p[0] * frequency, p[1] * frequency, p[2] * frequency]);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

function patternWoodRampTs(phase: number): number {
  const t = phase - Math.floor(phase);
  const latewood = smoothstepTs(0.62, 0.78, t) * (1 - smoothstepTs(0.91, 1, t));
  const ringLine = 1 - smoothstepTs(0, 0.04, Math.min(t, 1 - t));
  return Math.max(0.72 * latewood, ringLine);
}

function patternStrataRampTs(phase: number): number {
  const t = phase - Math.floor(phase);
  const broad = smoothstepTs(0.06, 0.16, t) * (1 - smoothstepTs(0.52, 0.66, t));
  const seam = 1 - smoothstepTs(0, 0.035, Math.abs(t - 0.61));
  return Math.max(0.72 * broad, seam);
}

function patternMarbleMacroRampTs(scale: number, p: Vec3, pm: Vec3): number {
  const safeScale = Math.max(scale, 0);
  const qScale = safeScale / PATTERN_DEFAULT_SCALE.marble;
  const qa = pm[0] * qScale;
  const qu = pm[1] * qScale;
  const qv = pm[2] * qScale;
  const plane = qa + 0.2 * qu - 0.12 * qv;
  const warpA = fbmTs([
    p[0] * qScale * 1.1 + 1.9,
    p[1] * qScale * 1.1 - 5.2,
    p[2] * qScale * 1.1 + 3.4,
  ]);
  const warpB = fbmTs([
    p[2] * qScale * 2.1 - 6.4,
    p[0] * qScale * 2.1 + 2.8,
    p[1] * qScale * 2.1 + 9.1,
  ]);
  const field = 0.34 * plane + warpA - 0.035;
  const branchField =
    0.2 * (0.58 * qa - 0.41 * qu + 0.29 * qv) +
    0.7 * warpA +
    0.46 * warpB -
    0.11;
  const branchGate = 1 - smoothstepTs(0.075, 0.19, Math.abs(warpA - warpB));
  const primaryDistance = Math.abs(field);
  const branchDistance = Math.abs(branchField);
  const core = Math.max(
    1 - smoothstepTs(0.018, 0.052, primaryDistance),
    branchGate * (1 - smoothstepTs(0.014, 0.044, branchDistance)),
  );
  const halo = Math.max(
    1 - smoothstepTs(0.052, 0.13, primaryDistance),
    0.72 * branchGate * (1 - smoothstepTs(0.044, 0.105, branchDistance)),
  );
  return clamp01(0.58 * halo + 0.42 * core);
}

function patternMacroRampTs(
  kindId: number,
  scale: number,
  p: Vec3,
  pm: Vec3,
): number {
  const safeScale = Math.max(scale, 0);
  if (kindId === 1) {
    const radial = Math.hypot(pm[1], pm[2]);
    const wobble = fbmTs([
      pm[1] * 1.25 + 0.7,
      pm[0] * 0.22 - 2.3,
      pm[2] * 1.25 + 4.7,
    ]);
    const axialGrain = fbmTs([pm[1] * 3 + 8, pm[0] * 0.35 - 4, pm[2] * 3 - 6]);
    const phase = (radial + 0.1 * wobble + 0.025 * axialGrain) * safeScale;
    return patternWoodRampTs(phase);
  }
  if (kindId === 2) {
    return patternMarbleMacroRampTs(scale, p, pm);
  }
  const warp = fbmTs([pm[1] * 0.6 - 4.3, pm[0] * 0.2 + 8.1, pm[2] * 0.6 + 2.7]);
  const phase = (pm[0] + 0.055 * warp) * safeScale;
  return patternStrataRampTs(phase);
}

function patternDetailWarpPointTs(
  kindId: number,
  detailScale: number,
  pm: Vec3,
  nativeValue: number,
  nativeEnabled: boolean,
): Vec3 {
  if (!nativeEnabled || detailScale <= 0) return pm;
  const warpCycles = PATTERN_NATIVE_WARP_CYCLES[kindIdToKind(kindId)];
  const shift = ((nativeValue - 0.5) * warpCycles) / detailScale;
  const warped: Vec3 = [pm[0], pm[1], pm[2]];
  if (kindId === 1) warped[1] += shift;
  else warped[0] += shift;
  return warped;
}

const kindIdToKind = (id: number): "wood" | "marble" | "strata" =>
  id === 1 ? "wood" : id === 2 ? "marble" : "strata";

function patternMarbleDetailRampTs(scale: number, p: Vec3, pm: Vec3): number {
  const safeScale = Math.max(scale, 0);
  const warp = fbmTs([
    pm[1] * safeScale * 0.28 + 3.7,
    pm[0] * safeScale * 0.2 - 6.1,
    pm[2] * safeScale * 0.28 + 1.9,
  ]);
  const warpB = fbmTs([
    pm[2] * safeScale * 0.24 - 4.8,
    pm[1] * safeScale * 0.18 + 2.6,
    pm[0] * safeScale * 0.24 + 7.3,
  ]);
  const phase = (pm[0] + 0.18 * pm[1] - 0.11 * pm[2]) * safeScale + 0.42 * warp;
  const branchPhase =
    (0.62 * pm[0] - 0.47 * pm[1] + 0.31 * pm[2]) * safeScale * 0.78 +
    0.48 * warpB +
    1.37;
  const vein = (veinPhase: number): number => {
    const distance = Math.abs(veinPhase - Math.floor(veinPhase) - 0.5);
    const core = 1 - smoothstepTs(0.018, 0.055, distance);
    const halo = 1 - smoothstepTs(0.055, 0.2, distance);
    return clamp01(0.58 * halo + 0.42 * core);
  };
  const cloud = 0.1 + 0.42 * clamp01(warp + 0.5);
  const branchGate = smoothstepTs(-0.04, 0.22, warp - 0.45 * warpB);
  const branch = 0.82 * branchGate * vein(branchPhase);
  const ramp = Math.max(cloud, vein(phase), branch);
  return clamp01(0.5 + (ramp - 0.5) * 2.25);
}

function patternMaterialDetailRampTs(
  kindId: number,
  scale: number,
  p: Vec3,
  pm: Vec3,
): number {
  return kindId === 2
    ? patternMarbleDetailRampTs(scale, p, pm)
    : patternMacroRampTs(kindId, scale, p, pm);
}

function patternVarianceRampMixTs(a: number, b: number, t: number): number {
  const mixed = mixF(a, b, t);
  const gain = 1 / Math.sqrt((1 - t) * (1 - t) + t * t);
  return clamp01(0.5 + (mixed - 0.5) * gain);
}

function patternScaleStableDetailRampTs(
  kindId: number,
  scale: number,
  p: Vec3,
  pm: Vec3,
  nativeValue: number,
  nativeEnabled: boolean,
  pixelFootprint: number,
): number {
  const footprint = Math.max(pixelFootprint, 1e-9);
  const detailScaleMult = PATTERN_DETAIL_SCALE_MULTIPLIER[kindIdToKind(kindId)];
  const desired = Math.max(
    1,
    (detailScaleMult * PATTERN_DETAIL_FOOTPRINT_OFF) / footprint,
  );
  const rawLevel = Math.log2(desired);
  const levelF = Math.max(
    0,
    Math.min(PATTERN_DETAIL_MAX_OCTAVE, Math.floor(rawLevel)),
  );
  const blend = smoothstepTs(0, 1, clamp01(rawLevel - levelF));
  const lowScale = scale * 2 ** levelF;
  const lowP = patternDetailWarpPointTs(
    kindId,
    lowScale,
    pm,
    nativeValue,
    nativeEnabled,
  );
  const low = patternMaterialDetailRampTs(kindId, lowScale, p, lowP);
  if (levelF >= PATTERN_DETAIL_MAX_OCTAVE) return low;
  const highScale =
    scale * 2 ** Math.min(PATTERN_DETAIL_MAX_OCTAVE, levelF + 1);
  const highP = patternDetailWarpPointTs(
    kindId,
    highScale,
    pm,
    nativeValue,
    nativeEnabled,
  );
  const high = patternMaterialDetailRampTs(kindId, highScale, p, highP);
  return patternVarianceRampMixTs(low, high, blend);
}

function patternDetailGateTs(pixelFootprint: number): number {
  return (
    1 -
    smoothstepTs(
      PATTERN_DETAIL_FOOTPRINT_FULL,
      PATTERN_DETAIL_FOOTPRINT_OFF,
      pixelFootprint,
    )
  );
}

function patternAlbedoTs(base: Vec3, kindId: number, ramp: number): Vec3 {
  const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
    mixF(a[0], b[0], t),
    mixF(a[1], b[1], t),
    mixF(a[2], b[2], t),
  ];
  let factor: Vec3;
  if (kindId === 1) {
    const early: Vec3 = [1.06, 1.03, 0.92];
    const late: Vec3 = [0.3, 0.22, 0.16];
    const amount = smoothstepTs(0.04, 0.92, ramp);
    factor = mix3(early, late, amount);
  } else if (kindId === 2) {
    const halo: Vec3 = [0.8, 0.78, 0.76];
    const core: Vec3 = [0.4, 0.43, 0.49];
    const haloAmount = smoothstepTs(0.02, 0.58, ramp);
    const coreAmount = smoothstepTs(0.58, 1, ramp);
    factor = mix3(mix3([1, 1, 1], halo, haloAmount), core, coreAmount);
  } else {
    const bed: Vec3 = [0.58, 0.62, 0.68];
    const seam: Vec3 = [0.38, 0.24, 0.16];
    const bedAmount = smoothstepTs(0.02, 0.72, ramp);
    const seamAmount = smoothstepTs(0.74, 1, ramp);
    factor = mix3(mix3([1, 1, 1], bed, bedAmount), seam, seamAmount);
  }
  return [
    clamp01(Math.fround(base[0] * factor[0])),
    clamp01(Math.fround(base[1] * factor[1])),
    clamp01(Math.fround(base[2] * factor[2])),
  ];
}

/** Re-exported for the parity tests: the GLSL emit's oracle-visible
 * constants, so the tests can hold the emission and the oracle to the same
 * numbers without reaching into surface-pattern's private helpers. */
export const PATTERN_SHADE_CONSTANTS = {
  detailFootprintFull: PATTERN_DETAIL_FOOTPRINT_FULL,
  detailFootprintOff: PATTERN_DETAIL_FOOTPRINT_OFF,
  detailMaxOctave: PATTERN_DETAIL_MAX_OCTAVE,
  noiseOctaves: PATTERN_NOISE_OCTAVES,
  kindRadix: SURFACE_PATTERN_WIRE_KIND_RADIX,
  axisRadix: SURFACE_PATTERN_WIRE_AXIS_RADIX,
  strengthSteps: SURFACE_PATTERN_WIRE_STRENGTH_STEPS,
} as const;

export type { PatternQuery };
