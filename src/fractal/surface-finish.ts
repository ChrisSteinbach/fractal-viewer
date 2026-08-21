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

/** A finish's six fields, resolved: never absent, never non-finite, and
 * always in the domain {@link resolveSurfaceFinish} enforces. */
export interface ResolvedSurfaceFinish {
  specular: number;
  shininess: number;
  metalness: number;
  reflect: number;
  transmit: number;
  reflectionTint: number;
}

/** The classic hardcoded values — today's Blinn-Phong formula, run
 * whenever a document authors no `finish` at all — shared so a caller can
 * compare a resolved finish against the default set by identity rather than
 * by re-typing six numbers. */
export const CLASSIC_SURFACE_FINISH: ResolvedSurfaceFinish = {
  specular: 0.4,
  shininess: 32,
  metalness: 0,
  reflect: 0,
  transmit: 0,
  reflectionTint: 1,
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
 * - `metalness`/`reflect`/`transmit`/`reflectionTint` clamp into `[0, 1]`,
 *   their own authored span (see each field's doc on {@link SurfaceFinish}).
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
  const reflectionTint = Number.isFinite(finish?.reflectionTint)
    ? clamp(finish?.reflectionTint as number, 0, 1)
    : CLASSIC_SURFACE_FINISH.reflectionTint;
  return {
    specular,
    shininess,
    metalness,
    reflect,
    transmit,
    reflectionTint,
  };
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
    r.transmit === CLASSIC_SURFACE_FINISH.transmit &&
    r.reflectionTint === CLASSIC_SURFACE_FINISH.reflectionTint
  );
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
  /** Optional production room/floor accessors. Present in both GLSL
   * tracers; WGSL supplies them only for a ground-plane kernel. */
  readonly groundY?: string;
  readonly groundBallC?: string;
  readonly groundBallR?: string;
  readonly groundAlbedo?: string;
  readonly groundPattern?: string;
  readonly groundTileScale?: string;
  readonly groundEmission?: string;
}

export const SURFACE_FINISH_GLSL: SurfaceFinishDialect = {
  language: "glsl",
  vec3: "vec3",
  lightDir: "uLightDir",
  ambient: "uAmbient",
  envStrength: "uEnvLight",
  bgTop: "uBgTop",
  bgBottom: "uBgBottom",
  groundY: "uGroundY",
  groundBallC: "uGroundBallC",
  groundBallR: "uGroundBallR",
  groundAlbedo: "uGroundAlbedo",
  groundPattern: "float(uGroundPattern)",
  groundTileScale: "uGroundTileScale",
  groundEmission: "uGroundEmission",
};

export const SURFACE_FINISH_WGSL: SurfaceFinishDialect = {
  language: "wgsl",
  vec3: "vec3f",
  lightDir: "shade.lightDir",
  ambient: "shade.ambient",
  envStrength: "shade.envStrength",
  bgTop: "shade.bgTop",
  bgBottom: "shade.bgBottom",
  groundY: "params.groundY",
  groundBallC: "params.groundBallC",
  groundBallR: "params.groundBallR",
  groundAlbedo: "params.groundAlbedo",
  groundPattern: "shade.balloonTint.z",
  groundTileScale: "shade.balloonTint.x",
  groundEmission: "shade.balloonTint.y",
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
 * The lanes come from `surface-material-wire.ts`'s shared material packer:
 * `fa = (specular, shininess, metalness, reflect)`, `fb = (transmit,
 * reflectionTint, patternConfig, scale)`. Finish lighting reads only fb.x/y;
 * the sibling pattern gate owns fb.z/w. `bg` is the pixel's own backdrop
 * (the value the caller's miss path would have
 * written); everything else is the call site's existing locals. Comments in
 * the emitted text are kept to one line — the 4D tracer's strip-threshold
 * headroom is measured in single kilobytes.
 */
function surfaceFinishBody(
  dialect: SurfaceFinishDialect,
  room: boolean,
): string {
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
  ${dv3} metalTint = mix(${v3}(1.0), linBase, fa.z * fb.y);
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
  ${room ? (isWgsl ? "var" : v3) : dv3} envR = pow(envBase, ${v3}(2.2)) + ${v3}(sunAmt);${
    room
      ? `
${isWgsl ? "" : "#if SURFACE_GROUND_PLANE"}
  // The authorable emitting floor is recognizable room content for a
  // mirror. Its cell width is relative to the certified world-space ball,
  // never to pixels, so a resize cannot retune the material.
  if (pos.y > ${dialect.groundY} && reflDir.y < -1.0e-5) {
    ${df} floorT = (${dialect.groundY} - pos.y) / reflDir.y;
    ${dv3} floorP = pos + reflDir * floorT;
    ${df} floorFade = 1.0 - smoothstep(${dialect.groundBallR} * 4.0, ${dialect.groundBallR} * 10.0, length(floorP.xz - ${dialect.groundBallC}.xz));
    ${df} cell = max(${dialect.groundBallR} * ${dialect.groundTileScale}, 1.0e-4);
    ${df} tileSum = floor((floorP.x - ${dialect.groundBallC}.x) / cell) + floor((floorP.z - ${dialect.groundBallC}.z) / cell);
    ${df} checker = tileSum - 2.0 * floor(tileSum * 0.5);
    ${df} tileTone = mix(1.0, mix(0.035, 1.0, checker), step(0.5, ${dialect.groundPattern}));
    ${dv3} floorBase = ${dialect.groundAlbedo} * tileTone;
    ${df} floorLit = ${dialect.ambient} + (1.0 - ${dialect.ambient}) * max(${dialect.lightDir}.y, 0.0) + ${dialect.groundEmission};
    envR = mix(envR, pow(floorBase, ${v3}(2.2)) * floorLit, floorFade);
  }
${isWgsl ? "" : "#endif"}`
      : ""
  }
  ${dv3} refl = (fa.w * fresnel) * metalTint * envR;
  ${dv3} col = pow(linBase * lit * (1.0 - fa.z) + metalTint * (spec * shadow) + refl, ${v3}(1.0 / 2.2));
  return mix(col, bg, fb.x * (1.0 - fresnel));
`;
}

function surfaceFinishSignature(
  dialect: SurfaceFinishDialect,
  room: boolean,
): string {
  return dialect.language === "glsl"
    ? `${dialect.vec3} finishShade(${dialect.vec3} base${room ? `, ${dialect.vec3} pos` : ""}, ${dialect.vec3} n, ${dialect.vec3} rd, float shadow, float ao, ${dialect.vec3} bg, vec4 fa, vec4 fb)`
    : `fn finishShade(base: ${dialect.vec3}${room ? `, pos: ${dialect.vec3}` : ""}, n: ${dialect.vec3}, rd: ${dialect.vec3}, shadow: f32, ao: f32, bg: ${dialect.vec3}, fa: vec4f, fb: vec4f) -> ${dialect.vec3}`;
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
  room = false,
): string {
  return `${surfaceFinishSignature(dialect, room)} {${surfaceFinishBody(dialect, room)}}\n`;
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
  floor?: {
    y: number;
    ballCenter: Vec3;
    ballRadius: number;
    albedo: Vec3;
    pattern: 0 | 1;
    tileScale: number;
    emission: number;
  };
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
  pos?: Vec3,
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
    mix(1, linBase[0], finish.metalness * finish.reflectionTint),
    mix(1, linBase[1], finish.metalness * finish.reflectionTint),
    mix(1, linBase[2], finish.metalness * finish.reflectionTint),
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
    let envR = Math.pow(envBase, 2.2) + sunAmt;
    const floor = env.floor;
    if (floor && pos && pos[1] > floor.y && reflDir[1] < -1e-5) {
      const floorT = (floor.y - pos[1]) / reflDir[1];
      const floorP: Vec3 = [
        pos[0] + reflDir[0] * floorT,
        pos[1] + reflDir[1] * floorT,
        pos[2] + reflDir[2] * floorT,
      ];
      const dx = floorP[0] - floor.ballCenter[0];
      const dz = floorP[2] - floor.ballCenter[2];
      const edge = Math.hypot(dx, dz);
      const a = floor.ballRadius * 4;
      const b = floor.ballRadius * 10;
      const u = clamp((edge - a) / (b - a), 0, 1);
      const floorFade = 1 - u * u * (3 - 2 * u);
      const cell = Math.max(floor.ballRadius * floor.tileScale, 1e-4);
      const tileSum = Math.floor(dx / cell) + Math.floor(dz / cell);
      const checker = tileSum - 2 * Math.floor(tileSum * 0.5);
      const tileTone = floor.pattern === 1 ? mix(0.035, 1, checker) : 1;
      const floorLit =
        env.ambient +
        (1 - env.ambient) * Math.max(env.lightDir[1], 0) +
        floor.emission;
      const floorR = Math.pow(floor.albedo[i] * tileTone, 2.2) * floorLit;
      envR = mix(envR, floorR, floorFade);
    }
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
