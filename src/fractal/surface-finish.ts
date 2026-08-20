import type { SurfaceFinish, Vec3 } from "./types";
import { clamp } from "./vec";

/**
 * The MEANING of {@link SurfaceFinish} — `variations.ts`'s
 * {@link import("./variations").resolveFoldRadii} role, one feature over.
 * Pure, dependency-free: this module owns the ONE "absent means classic"
 * definition and the resolver's domain, so nothing else may re-derive
 * either.
 *
 * Classic values ARE today's hardcoded Blinn-Phong shading constants — the
 * formula Surface mode's tracers ran before this field existed — so
 * resolving an absent (or absent-field) finish reproduces that formula
 * exactly. That is the resolver/persist split: `persist.ts` encodes/decodes
 * for FIDELITY only (no coercion, no clamp — an out-of-domain but finite
 * authored value survives the wire untouched), and this module alone owns
 * the DOMAIN a resolved value is read through. {@link isClassicSurfaceFinish}
 * is what will let a later slice gate "does this document need the
 * parameterized shader path at all" the same way
 * `variations.ts`'s `isClassicFoldRadii` gates the fold branch's shared
 * classic entry.
 */

/** A finish's five fields, resolved: never absent, never non-finite, and
 * always in the domain {@link resolveSurfaceFinish} enforces. */
export interface ResolvedSurfaceFinish {
  specular: number;
  shininess: number;
  metalness: number;
  reflect: number;
  transmit: number;
}

/** The classic hardcoded values — today's Blinn-Phong formula, run
 * whenever a document authors no `finish` at all — shared so a caller can
 * compare a resolved finish against the default set by identity rather than
 * by re-typing five numbers. */
export const CLASSIC_SURFACE_FINISH: ResolvedSurfaceFinish = {
  specular: 0.4,
  shininess: 32,
  metalness: 0,
  reflect: 0,
  transmit: 0,
};

/**
 * Smallest legal `shininess`: strictly above 0, `pow`'s domain — GLSL
 * `pow(0.0, 0.0)` is undefined, and a zero-or-negative exponent breaks the
 * highlight's own semantics (it should narrow monotonically as the exponent
 * grows, never invert). A FLOOR rather than a fallback to the classic 32 —
 * unlike a non-finite input, an authored near-zero value is a deliberate
 * "almost matte" request and should read as one, not snap back to the
 * default highlight.
 */
export const SURFACE_FINISH_SHININESS_FLOOR = 0.01;

/**
 * A transform's finish, with absent and out-of-domain values resolved — THE
 * ONE PLACE the "absent means classic" rule from {@link SurfaceFinish} is
 * written down. Total: every input, including `undefined` itself, resolves
 * to a finite, in-domain value; this function never throws.
 *
 * The domain it enforces, field by field:
 * - Each field absent OR non-finite resolves to its
 *   {@link CLASSIC_SURFACE_FINISH} value — `persist.ts` already drops
 *   non-finite values on decode, but the resolver stays total on its own
 *   input regardless, exactly as `variations.ts`'s `resolveFoldRadii` does
 *   for the fold's three lengths.
 * - `specular` clamps to `>= 0` only — no ceiling; an overdriven highlight
 *   past the classic 0.4 is legal authoring.
 * - `shininess` floors at {@link SURFACE_FINISH_SHININESS_FLOOR}, strictly
 *   above zero, and is otherwise unbounded above.
 * - `metalness`/`reflect`/`transmit` clamp into `[0, 1]`, their own authored
 *   span (see each field's doc on {@link SurfaceFinish}).
 */
export function resolveSurfaceFinish(
  finish: SurfaceFinish | undefined,
): ResolvedSurfaceFinish {
  const specular = Number.isFinite(finish?.specular)
    ? Math.max(0, finish?.specular as number)
    : CLASSIC_SURFACE_FINISH.specular;
  const shininess = Number.isFinite(finish?.shininess)
    ? Math.max(SURFACE_FINISH_SHININESS_FLOOR, finish?.shininess as number)
    : CLASSIC_SURFACE_FINISH.shininess;
  const metalness = Number.isFinite(finish?.metalness)
    ? clamp(finish?.metalness as number, 0, 1)
    : CLASSIC_SURFACE_FINISH.metalness;
  const reflect = Number.isFinite(finish?.reflect)
    ? clamp(finish?.reflect as number, 0, 1)
    : CLASSIC_SURFACE_FINISH.reflect;
  const transmit = Number.isFinite(finish?.transmit)
    ? clamp(finish?.transmit as number, 0, 1)
    : CLASSIC_SURFACE_FINISH.transmit;
  return { specular, shininess, metalness, reflect, transmit };
}

/**
 * Are these the classic values — i.e. does this finish shade exactly as it
 * did before the field existed? Resolves `finish` and compares every field
 * against {@link CLASSIC_SURFACE_FINISH}, so this is true when `finish` is
 * absent (resolving it produces the classic set by definition), when every
 * present field was explicitly authored at its own classic value, and when
 * a present field is non-finite (it resolves classic too) — false only when
 * some field genuinely RESOLVES away from classic. This predicate is what
 * will drive a later slice's shader-compile gate: a classic-resolving
 * document must compile literally today's program text, mirroring
 * `variations.ts`'s `isClassicFoldRadii` one feature over.
 */
export function isClassicSurfaceFinish(
  finish: SurfaceFinish | undefined,
): boolean {
  const r = resolveSurfaceFinish(finish);
  return (
    r.specular === CLASSIC_SURFACE_FINISH.specular &&
    r.shininess === CLASSIC_SURFACE_FINISH.shininess &&
    r.metalness === CLASSIC_SURFACE_FINISH.metalness &&
    r.reflect === CLASSIC_SURFACE_FINISH.reflect &&
    r.transmit === CLASSIC_SURFACE_FINISH.transmit
  );
}

/**
 * The finish's two wire lanes — the ONE definition of which field rides
 * which component, shared by every packer so the WGSL `shadeMaps` stride
 * lanes and the GLSL `uMapFinishA`/`uMapFinishB` uniform arrays cannot
 * disagree about lane order. `a = (specular, shininess, metalness,
 * reflect)`, `b = (transmit, 0, 0, 0)` — `b`'s trailing three are RESERVED
 * for the Tier-2 pattern fields (patternKind, patternScale,
 * patternStrength), declared in the layout now so the pattern slice lands
 * without a second stride change, zero-filled until it exists.
 */
export function surfaceFinishLanes(finish: ResolvedSurfaceFinish): {
  a: [number, number, number, number];
  b: [number, number, number, number];
} {
  return {
    a: [finish.specular, finish.shininess, finish.metalness, finish.reflect],
    b: [finish.transmit, 0, 0, 0],
  };
}

/**
 * THE REFLECTED SUN, and why the environment has one at all.
 *
 * An image-based reflection can only ever show what the environment
 * contains, and this app's environment was a two-stop vertical gradient —
 * which has no structure, so a mirror made of it reads as flat paint
 * rather than as metal. MEASURED, on a Menger sponge at metalness 1 under
 * the shipped dark backdrop: the surface renders very nearly black, and
 * the fault is not the BRDF but the picture it is reflecting.
 *
 * So the environment gains the two features that make a reflection legible
 * — a HORIZON (the backdrop's own two stops split about `dir.y` with the
 * project's own smoothstep easing) and a SUN (a tight disc plus a broad
 * glow along the scene's light direction). Both are derived from
 * quantities every shading site ALREADY has — `bgTop`/`bgBottom` and
 * `lightDir` — so this costs NO new uniform, no params-block byte, and no
 * document state, and the reflected sun necessarily agrees with the
 * specular highlight because they read the same light.
 *
 * The intensities are module constants rather than sliders, the balloon
 * dim's stance: a second brightness knob for a term that already has
 * `reflect` as its weight would be two controls over one quantity.
 *
 * NONE OF THIS TOUCHES THE CLASSIC PATH, by construction rather than by
 * care: the environment is read only by the reflection term, which is
 * weighted by `fa.w` (`reflect`), whose classic value is 0 — so
 * `finishShadeTs`'s exact classic-params pin against the fixed formula
 * holds unchanged, and an unauthored document still compiles literally
 * today's program text through the compile gate.
 */
const SUN_DISC_TIGHTNESS = "400.0";
const SUN_DISC_INTENSITY = "14.0";
const SUN_GLOW_TIGHTNESS = "1.0";
const SUN_GLOW_INTENSITY = "2.0";

/**
 * One shader dialect's spelling for the emitted `finishShade` function —
 * `background-shape.ts`'s {@link import("./background-shape").BackgroundShapeDialect}
 * pattern applied to lighting. Unlike the backdrop shape's regular
 * `uBg${name}` / `shade.bg${name}` accessor pair, the lighting quantities'
 * two spellings are NOT one rename apart (`uEnvLight` vs
 * `shade.envStrength`), so each accessor is carried explicitly rather than
 * derived from a prefix rule.
 */
export interface SurfaceFinishDialect {
  readonly language: "glsl" | "wgsl";
  /** `vec3` / `vec3f` — the constructor-and-type spelling. */
  readonly vec3: string;
  /** The light direction uniform: `uLightDir` / `shade.lightDir`. */
  readonly lightDir: string;
  /** The ambient fraction: `uAmbient` / `shade.ambient`. */
  readonly ambient: string;
  /** Environment-light strength: `uEnvLight` / `shade.envStrength`. */
  readonly envStrength: string;
  /** The backdrop's two stops: `uBgTop`+`uBgBottom` / `shade.bgTop`+`shade.bgBottom`. */
  readonly bgTop: string;
  readonly bgBottom: string;
}

export const SURFACE_FINISH_GLSL: SurfaceFinishDialect = {
  language: "glsl",
  vec3: "vec3",
  lightDir: "uLightDir",
  ambient: "uAmbient",
  envStrength: "uEnvLight",
  bgTop: "uBgTop",
  bgBottom: "uBgBottom",
};

export const SURFACE_FINISH_WGSL: SurfaceFinishDialect = {
  language: "wgsl",
  vec3: "vec3f",
  lightDir: "shade.lightDir",
  ambient: "shade.ambient",
  envStrength: "shade.envStrength",
  bgTop: "shade.bgTop",
  bgBottom: "shade.bgBottom",
};

/**
 * The shared function BODY — ONE template both dialects emit from, so the
 * three shader sites (the WGSL shade entry and the two GLSL tracers) cannot
 * drift on the ARITHMETIC (`background-shape.ts`'s `backgroundShapeBody`
 * discipline). Per-dialect tokens: the local-declaration keyword (GLSL's
 * typed `vec3 x` / `float x` against WGSL's inferred `let x`), the
 * `vec3`/`vec3f` constructor spelling, and the lighting accessors above;
 * everything else is the same characters in both, and a test pins the two
 * bodies equal once those tokens are normalized away.
 *
 * WHAT IT COMPUTES — the parametric form of the tracers' fixed lighting
 * composition, `finishShadeTs` mirrored term for term; classic params
 * (0.4/32/0/0/0) reproduce the fixed formula's VALUES exactly (each extra
 * term reduces to `* 1.0`, `+ 0.0`, or `mix(x, y, 0.0)`):
 * - Blinn-Phong specular `fa.x * pow(max(dot(n, h), 0), fa.y)`, its lobe
 *   tinted by the surface's own linear albedo as metalness rises
 *   (`metalTint`) — a metal's highlight carries its color, while the
 *   classic metalness-0 highlight stays deliberately untinted (the envTint
 *   note's rule survives as the default).
 * - Diffuse damped by `(1 - metalness)` — a pure metal has no diffuse body.
 * - Schlick fresnel on `dot(n, -rd)` with `F0 = mix(0.04, 1.0, metalness)`.
 * - Image-based reflection: the backdrop's two stops sampled along
 *   `reflect(rd, n)` — envTint's own hemisphere convention (`y*0.5+0.5`)
 *   evaluated at the REFLECTED direction — decoded to linear, weighted
 *   `fa.w * fresnel`, tinted by `metalTint`, added in linear light inside
 *   the gamma encode.
 * - Thin-shell transmission: `mix(col, bg, fb.x * (1 - fresnel))` AFTER the
 *   encode — the same gamma-space blend-toward-backdrop convention the fog
 *   mix (which stays at the call site, LAST) already uses, so a
 *   transmissive surface reads as a partial miss toward its own pixel's
 *   backdrop while fresnel keeps its grazing reflections.
 *
 * The lanes are {@link surfaceFinishLanes}': `fa = (specular, shininess,
 * metalness, reflect)`, `fb = (transmit, pattern... reserved)`. `bg` is the
 * pixel's own backdrop (the value the caller's miss path would have
 * written); everything else is the call site's existing locals. Comments in
 * the emitted text are kept to one line — the 4D tracer's strip-threshold
 * headroom is measured in single kilobytes.
 */
function surfaceFinishBody(dialect: SurfaceFinishDialect): string {
  const isWgsl = dialect.language === "wgsl";
  const v3 = dialect.vec3;
  const dv3 = isWgsl ? "let" : "vec3";
  const df = isWgsl ? "let" : "float";
  return `
  // Shared body — see finishShadeTs in surface-finish.ts.
  ${dv3} linBase = pow(base, ${v3}(2.2));
  ${df} diffuse = max(dot(n, ${dialect.lightDir}), 0.0);
  ${dv3} halfVec = normalize(${dialect.lightDir} - rd);
  ${df} spec = fa.x * pow(max(dot(n, halfVec), 0.0), fa.y);
  ${dv3} metalTint = mix(${v3}(1.0), linBase, fa.z);
  ${dv3} envE = mix(${dialect.bgBottom}, ${dialect.bgTop}, n.y * 0.5 + 0.5);
  ${dv3} envTintV = mix(${v3}(1.0), envE / max(max(envE.r, max(envE.g, envE.b)), 1.0e-4), ${dialect.envStrength});
  ${dv3} lit = (${dialect.ambient} * ao + (1.0 - ${dialect.ambient}) * diffuse * shadow) * envTintV;
  ${df} f0 = mix(0.04, 1.0, fa.z);
  ${df} fresnel = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 5.0);
  ${dv3} reflDir = reflect(rd, n);
  // The reflected ENVIRONMENT — the backdrop's own two stops split at a
  // horizon, plus a sun disc along the scene's light. See SURFACE_FINISH_SUN.
  ${df} horizon = clamp(reflDir.y * 0.5 + 0.5, 0.0, 1.0);
  ${dv3} envBase = mix(${dialect.bgBottom}, ${dialect.bgTop}, horizon * horizon * (3.0 - 2.0 * horizon));
  ${df} sunDot = max(dot(reflDir, ${dialect.lightDir}), 0.0);
  ${df} sunAmt = pow(sunDot, ${SUN_DISC_TIGHTNESS}) * ${SUN_DISC_INTENSITY} + pow(sunDot, ${SUN_GLOW_TIGHTNESS}) * ${SUN_GLOW_INTENSITY};
  ${dv3} envR = pow(envBase, ${v3}(2.2)) + ${v3}(sunAmt);
  ${dv3} refl = (fa.w * fresnel) * metalTint * envR;
  ${dv3} col = pow(linBase * lit * (1.0 - fa.z) + metalTint * (spec * shadow) + refl, ${v3}(1.0 / 2.2));
  return mix(col, bg, fb.x * (1.0 - fresnel));
`;
}

function surfaceFinishSignature(dialect: SurfaceFinishDialect): string {
  return dialect.language === "glsl"
    ? `${dialect.vec3} finishShade(${dialect.vec3} base, ${dialect.vec3} n, ${dialect.vec3} rd, float shadow, float ao, ${dialect.vec3} bg, vec4 fa, vec4 fb)`
    : `fn finishShade(base: ${dialect.vec3}, n: ${dialect.vec3}, rd: ${dialect.vec3}, shadow: f32, ao: f32, bg: ${dialect.vec3}, fa: vec4f, fb: vec4f) -> ${dialect.vec3}`;
}

/**
 * Emit `finishShade` as source text in one dialect — the signature from
 * {@link surfaceFinishSignature}, the body from {@link surfaceFinishBody}.
 * `SURFACE_FINISH_GLSL`/`_WGSL` splice into
 * `surface-material.ts`/`surface-material-4d.ts`'s GLSL (under the
 * `SURFACE_FINISH` define) and `surface-de-gpu.ts`'s WGSL shade entry
 * (under the `finish` codegen flag) respectively — always define-gated on
 * the shader side, because the parametric path is NOT a byte-identity with
 * the fixed formula (`pow(x, 32.0)` literal vs uniform); an unauthored
 * document compiles literally the fixed program text and this function's
 * output never reaches it.
 */
export function surfaceFinishShadeSource(
  dialect: SurfaceFinishDialect,
): string {
  return `${surfaceFinishSignature(dialect)} {${surfaceFinishBody(dialect)}}\n`;
}

/** The lighting-environment quantities {@link finishShadeTs} reads — the
 * uniforms/params the shader bodies reach through their dialect accessors,
 * gathered as one argument so a CPU render (the pattern sheet's shading
 * hook, the parity tests) can pose them freely. */
export interface SurfaceFinishShadeEnv {
  lightDir: Vec3;
  ambient: number;
  envStrength: number;
  bgTop: Vec3;
  bgBottom: Vec3;
}

/**
 * The TS mirror of {@link surfaceFinishBody}, term for term and in ITS
 * OPERATION ORDER (every `mix` is spelled `x*(1-t) + y*t`, the GLSL/WGSL
 * definition), so at the classic params it reproduces the tracers' fixed
 * formula EXACTLY in double precision — the pinned claim that makes the
 * shader emission trustworthy — and so `scripts/de-preview.ts`'s shading
 * hook can render finish contact sheets with the real composition rather
 * than a ninth approximation. `base` and the backdrop stops arrive
 * sRGB-authored exactly as the tracers' do; the return is the pre-fog,
 * gamma-encoded color (fog stays the caller's, LAST — the shader call
 * sites' own convention).
 */
export function finishShadeTs(
  base: Vec3,
  n: Vec3,
  rd: Vec3,
  shadow: number,
  ao: number,
  bg: Vec3,
  finish: ResolvedSurfaceFinish,
  env: SurfaceFinishShadeEnv,
): Vec3 {
  const mix = (x: number, y: number, t: number): number => x * (1 - t) + y * t;
  const dot3 = (a: Vec3, b: Vec3): number =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const linBase: Vec3 = [
    Math.pow(base[0], 2.2),
    Math.pow(base[1], 2.2),
    Math.pow(base[2], 2.2),
  ];
  const diffuse = Math.max(dot3(n, env.lightDir), 0);
  const halfRaw: Vec3 = [
    env.lightDir[0] - rd[0],
    env.lightDir[1] - rd[1],
    env.lightDir[2] - rd[2],
  ];
  const halfLen = Math.sqrt(dot3(halfRaw, halfRaw));
  const halfVec: Vec3 = [
    halfRaw[0] / halfLen,
    halfRaw[1] / halfLen,
    halfRaw[2] / halfLen,
  ];
  const spec =
    finish.specular * Math.pow(Math.max(dot3(n, halfVec), 0), finish.shininess);
  const metalTint: Vec3 = [
    mix(1, linBase[0], finish.metalness),
    mix(1, linBase[1], finish.metalness),
    mix(1, linBase[2], finish.metalness),
  ];
  const envY = n[1] * 0.5 + 0.5;
  const envE: Vec3 = [
    mix(env.bgBottom[0], env.bgTop[0], envY),
    mix(env.bgBottom[1], env.bgTop[1], envY),
    mix(env.bgBottom[2], env.bgTop[2], envY),
  ];
  const envMax = Math.max(Math.max(envE[0], Math.max(envE[1], envE[2])), 1e-4);
  const litScalar = env.ambient * ao + (1 - env.ambient) * diffuse * shadow;
  const lit: Vec3 = [
    litScalar * mix(1, envE[0] / envMax, env.envStrength),
    litScalar * mix(1, envE[1] / envMax, env.envStrength),
    litScalar * mix(1, envE[2] / envMax, env.envStrength),
  ];
  const f0 = mix(0.04, 1.0, finish.metalness);
  const negRd: Vec3 = [-rd[0], -rd[1], -rd[2]];
  const fresnel = f0 + (1 - f0) * Math.pow(1 - clamp(dot3(n, negRd), 0, 1), 5);
  // reflect(I, N) = I - 2*dot(N, I)*N — the GLSL/WGSL intrinsic's definition.
  const dNI = dot3(n, rd);
  const reflDir: Vec3 = [
    rd[0] - 2 * dNI * n[0],
    rd[1] - 2 * dNI * n[1],
    rd[2] - 2 * dNI * n[2],
  ];
  // The reflected environment, mirroring the shared body's own lines: the
  // backdrop's two stops split at a horizon, plus the sun disc and glow
  // along the light (see SUN_DISC_TIGHTNESS's doc for why it exists).
  const horizon = clamp(reflDir[1] * 0.5 + 0.5, 0, 1);
  const horizonT = horizon * horizon * (3 - 2 * horizon);
  const sunDot = Math.max(dot3(reflDir, env.lightDir), 0);
  const sunAmt =
    Math.pow(sunDot, Number(SUN_DISC_TIGHTNESS)) * Number(SUN_DISC_INTENSITY) +
    Math.pow(sunDot, Number(SUN_GLOW_TIGHTNESS)) * Number(SUN_GLOW_INTENSITY);
  const reflW = finish.reflect * fresnel;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0 as 0 | 1 | 2; i < 3; i++) {
    const envBase = mix(env.bgBottom[i], env.bgTop[i], horizonT);
    const envR = Math.pow(envBase, 2.2) + sunAmt;
    const refl = reflW * metalTint[i] * envR;
    const col = Math.pow(
      linBase[i] * lit[i] * (1 - finish.metalness) +
        metalTint[i] * (spec * shadow) +
        refl,
      1 / 2.2,
    );
    out[i] = mix(col, bg[i], finish.transmit * (1 - fresnel));
  }
  return out;
}

// ----------------------------------------------------------- Tier-2 pattern

/** {@link SurfaceFinishPattern.kind} vocabulary — numeric, like
 * `surface-de.ts`'s fold kinds, because the value rides a shader lane
 * (`surfaceFinishLanes`' reserved `b.y`) and a shader dispatches on it. */
export const SURFACE_PATTERN_NONE = 0;
/** Wood: growth rings through an asymmetric earlywood/latewood ramp, driven
 * by the hit's `rings` trap (its descent orbit's closest radial approach to
 * the attractor's centre, normalized by the bounding radius). */
export const SURFACE_PATTERN_WOOD = 1;
/** Marble: sharp dark veins on a band-pass of the hit's `sheets` trap (its
 * descent orbit's closest approach to the attractor frame's `y = 0` plane,
 * normalized the same way). */
export const SURFACE_PATTERN_MARBLE = 2;

/** The three pattern parameters — the reserved `b.yzw` lanes of
 * {@link surfaceFinishLanes}, in lane order. */
export interface SurfaceFinishPattern {
  /** One of the `SURFACE_PATTERN_*` kinds; anything else reads as none. */
  kind: number;
  /** Band frequency: bands per unit of the driving trap coordinate (the
   * trap is normalized to `[0, 1]`, so this is roughly the band count across
   * the whole attractor). */
  scale: number;
  /** How much of the patterned albedo shows over the plain base, `[0, 1]`:
   * `mix(base, patterned, strength)`. */
  strength: number;
}

/** The per-hit quantities a pattern may read. `rings`/`sheets` are the
 * tracers' hit-info traps, already clamped to `[0, 1]`; `p` is the hit's
 * world position, RESERVED for a world-space kind (neither shipped kind
 * reads it — both are driven by descent quantities precisely so the grain
 * keeps resolving under zoom, where any world-space field plateaus). */
export interface SurfaceFinishPatternQuery {
  rings: number;
  sheets: number;
  p: Vec3;
}

/** Latewood albedo factor: the dark half of a growth ring is this fraction
 * of the earlywood's brightness, hue preserved (a scalar, so a
 * palette-driven or authored base keeps its own colour). */
export const WOOD_LATEWOOD_DARKEN = 0.5;
/** Where in one ring period the earlywood -> latewood ramp rises (gradual)
 * and where the latewood -> next ring edge falls (sharp): the asymmetric
 * sawtooth a growth ring actually has. The ramp is 0 at both ends of the
 * period, so it is continuous across the `fract` wrap. */
export const WOOD_RISE: readonly [number, number] = [0.15, 0.75];
export const WOOD_FALL: readonly [number, number] = [0.9, 1.0];
/** Vein albedo factor at a marble vein's centre. */
export const MARBLE_VEIN_DARKEN = 0.35;
/** Half-width of a vein, as a fraction of one band period. */
export const MARBLE_VEIN_HALF_WIDTH = 0.08;

/**
 * The ONE definition of what a pattern does to a hit's albedo — the
 * function a shader emission would mirror term for term, so it is written
 * in shader-portable arithmetic only (`fract`/`smoothstep`/`mix`/`clamp`
 * spelled by their GLSL definitions, no branch on anything but the integer
 * kind). Applied to the BASE albedo BEFORE lighting, so the pattern shades
 * as geometry under {@link finishShadeTs}'s composition rather than being
 * painted over it.
 *
 * - Kind none (and any unrecognized kind) returns `base` exactly.
 * - WOOD: `t = fract(rings * scale)`; a darkening weight
 *   `smoothstep(WOOD_RISE) * (1 - smoothstep(WOOD_FALL))` over `t` — the
 *   gradual earlywood -> latewood rise and the sharp ring edge; the
 *   patterned albedo is `base * mix(1, WOOD_LATEWOOD_DARKEN, weight)`.
 * - MARBLE: `d = |fract(sheets * scale) - 0.5|`; a vein weight
 *   `1 - smoothstep(0, MARBLE_VEIN_HALF_WIDTH, d)` — a sharp band at the
 *   period's centre, exactly zero elsewhere; `base * mix(1,
 *   MARBLE_VEIN_DARKEN, weight)`.
 * - `strength` then mixes the patterned albedo over the plain base, spelled
 *   `x * (1 - t) + y * t` so strength 0 is `base` EXACTLY (the absent-field
 *   value a later document slice will resolve to) and every document
 *   without a pattern renders byte for byte.
 *
 * The result is the base scaled by a factor clamped into `[0, 1]`, so an
 * in-range base stays in range whatever the pattern parameters.
 *
 * NO RENDERER READS THIS YET — `surfaceFinishLanes`' pattern lanes are
 * reserved, zero-filled, not wired to any shader emission, document field
 * or UI control — and for WOOD it never will. `scripts/finish-pattern.harness.ts`
 * is this function's own `qjulia-de.ts`: the executable measurement that
 * decided the question rather than a hunch. Every system's own calibrated
 * ~8-band panel sits at 74-79% edge density (the share of adjacent hit
 * pixels whose patterned albedo steps by more than a tenth of the wood
 * ramp's own latewood drop) at ordinary viewing scale — the pattern changes
 * on MOST pixels, which is speckle/corrosion texture, not the coherent
 * banding wood grain needs, because `rings` varies at the fractal's own
 * detail frequency: exactly the property that lets it keep resolving under
 * zoom (the sheet's other finding — menger's own wood panel holds albedoVar
 * 0.0139 -> 0.0137 -> 0.0151 across 1x/8x/64x while a world-space fallback's
 * collapses to 0.0039 over the same ladder — confirms the zoom claim even as
 * it refutes the grain one). So WOOD is CLOSED won't-do, the verdict
 * `qjulia-de.ts` reached for its own object: this module stays as the
 * pattern math's ONE definition, and the harness stays as the executable
 * record of the measurement that refused it.
 *
 * MARBLE SURVIVES, as a DIFFERENT feature from the one measured here: 23-28%
 * edge density at every system and every zoom level, visibly band-like, and
 * it keeps that character under magnification. It goes unwired for the same
 * reason wood does — the reserved lanes above — but unlike wood it remains a
 * legitimate candidate for that wiring (its own document field, WGSL
 * emission, both GLSL arms, UI, a shader-size re-measure), filed as
 * follow-on work rather than shipped here.
 */
export function surfaceFinishPatternAlbedo(
  base: Vec3,
  pattern: SurfaceFinishPattern,
  q: SurfaceFinishPatternQuery,
): Vec3 {
  const kind = pattern.kind;
  if (kind !== SURFACE_PATTERN_WOOD && kind !== SURFACE_PATTERN_MARBLE) {
    return [base[0], base[1], base[2]];
  }
  const fract = (x: number): number => x - Math.floor(x);
  const smoothstep = (e0: number, e1: number, x: number): number => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const mix = (x: number, y: number, t: number): number => x * (1 - t) + y * t;
  let weight: number;
  let darken: number;
  if (kind === SURFACE_PATTERN_WOOD) {
    const t = fract(q.rings * pattern.scale);
    weight =
      smoothstep(WOOD_RISE[0], WOOD_RISE[1], t) *
      (1 - smoothstep(WOOD_FALL[0], WOOD_FALL[1], t));
    darken = WOOD_LATEWOOD_DARKEN;
  } else {
    const d = Math.abs(fract(q.sheets * pattern.scale) - 0.5);
    weight = 1 - smoothstep(0, MARBLE_VEIN_HALF_WIDTH, d);
    darken = MARBLE_VEIN_DARKEN;
  }
  const patterned = mix(1, darken, weight);
  const factor = clamp(mix(1, patterned, pattern.strength), 0, 1);
  return [base[0] * factor, base[1] * factor, base[2] * factor];
}
