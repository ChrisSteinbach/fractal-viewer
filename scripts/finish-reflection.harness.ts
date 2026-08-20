/**
 * Does traced reflection make a fractal look like METAL? — and if not, what
 * does? The per-transform finish feature reached the user with four green
 * gates behind it and was rejected on sight ("the metal does not look like
 * metal"), because every one of those gates asked whether an authored frame
 * DIFFERS from an unauthored one and none asked what it looks like. This
 * sheet is the missing instrument for the reflection half, and its four
 * verdicts came out in an order nobody predicted.
 *
 * ── VERDICT 1: A FRACTAL IS NOT A MIRROR ────────────────────────────────
 *
 * Replace the environment with a checkerboard and the background checkers
 * come out crisp while the object comes out as pure static. A fractal has no
 * scale at which it is locally flat, so neighbouring pixels reflect toward
 * wildly different parts of the environment and the reflected image
 * shatters. Not undersampling and not a framing problem: sixteen samples per
 * pixel converge to flat grey, so does a wide gloss cone, and zooming in
 * does not help because the sponge is exactly self-similar and is equally
 * rough at every scale.
 *
 * A FIRST DRAFT OF THIS VERDICT SAID THE MIRROR RETURNS THE ENVIRONMENT'S
 * MEAN, AND THE SHEET REFUTED IT. Rendering the same scene against a
 * checkerboard sky and against a UNIFORM sky of equal mean radiance, the two
 * differ by 85/255 — and that figure is FLAT across every filter width
 * below. Each pixel carries a real, correct sample of the environment;
 * nothing is averaged away. What the reflection lacks is ARRANGEMENT:
 * neighbouring pixels sample far-apart directions, so the image is scrambled
 * rather than integrated. (Averaging is what supersampling then does TO the
 * scramble, which is why 16 samples per pixel go grey — the same fact one
 * level up, and the reason the first draft mistook one for the other.)
 *
 * So the standing result is that a self-similar surface reflects INCOHERENTLY
 * at rendering resolution, and a smooth gradient environment has always
 * HIDDEN that: put structure in the environment and the scramble is what you
 * see.
 *
 * ── VERDICT 2: THE REFLECTION NORMAL MUST BE FILTERED ───────────────────
 *
 * Both engines take the shading normal from a four-tap tetrahedron at
 * `max(pixelEps·t, R·2e-4)` — the pixel's own world size
 * (`surface-material.ts`'s `h`, `surface-de-gpu.ts`'s shade entry). Widen
 * that tap FOR THE REFLECTION DIRECTION ONLY and the mirror comes back: it
 * is geometric mip-mapping, reflecting off the shape at a scale the frame
 * can resolve while the march, the silhouette and the holes stay at full
 * precision. MEASURED, one scene, environment-only, nothing else varied:
 * mean luminance 123.4 -> 123.3 (UNCHANGED) while 25.6/255 of every pixel
 * MOVED. It recovers no information — it recovers COHERENCE, which is
 * exactly what the refutation above says was missing.
 *
 * ── VERDICT 2b: THE FILTER HAS A WINDOW, AND FIGHTS THE TRACER ──────────
 *
 * The width is NOT a free parameter, and the two ladders below bracket it
 * from opposite sides. Coherence rises with the tap width and then falls off
 * again once the normal is averaged over so much geometry that the
 * reflection stops following the surface; and what TRACING buys decays
 * monotonically as the tap widens (13.1 -> 12.9 -> 11.8 -> 9.0/255 at
 * 3x/6x/12x/20x), because a wider tap makes neighbouring reflected rays more
 * parallel, so more of them escape to the room instead of striking the
 * object and the self-occlusion the tracer exists to compute is smoothed
 * away. Too narrow and the mirror is static; too wide and tracing stops
 * paying.
 *
 * AND THE MULTIPLE IS THE WRONG PARAMETERISATION, which this sheet
 * demonstrated by accident and which is the most useful thing in it for
 * whoever implements the filter. Raising the diagnostic's panels from 150px
 * to 230px — a 1.53x change, nothing else touched — moved the coherence peak
 * from 8x to 20x or beyond:
 *
 *     width      1x     3x     8x    20x
 *     150px    0.050  0.093  0.127  0.108     peak at 8x
 *     230px    0.045  0.088  0.113  0.165     peak at 20x or wider
 *
 * The pixel shrank and the best MULTIPLE of it grew by more than the pixel
 * shrank, which is what a roughly constant WORLD-SPACE blur looks like when
 * you insist on measuring it in pixels. A constant tuned in these units
 * would change the material every time the window is resized, and that is a
 * defect rather than a tuning nit. So the shippable form is a world-space
 * width (a fraction of the bounding radius) or, better, Toksvig/LEAN-style
 * variance filtering where the normal's spread within the footprint becomes
 * GLOSS rather than a hand-set number. That also casts doubt on this study's
 * gloss-cone result (3.7x cost for 4.67/255): the cone blurred around a
 * NOISY normal, which averages noise, where variance filtering blurs around
 * a filtered one.
 *
 * ── VERDICT 3: A TRACER TRANSPORTS LIGHT; IT DOES NOT CREATE IT ─────────
 *
 * The one that reorders the whole epic, and the one every earlier sheet
 * missed by rendering against a bright instrument backdrop instead of the
 * app's own. On the SHIPPED dark backdrop the scene contains a near-black
 * gradient and a pinpoint sun, and nothing else emits — so secondary rays
 * redistribute approximately zero and return approximately zero. MEASURED,
 * chrome balloon, app's real stops: environment-only mean luminance 26.7,
 * three traced bounces 23.7, a difference of 5.64/255. THE TRACER RAN AND
 * THE PICTURE STAYED BLACK.
 *
 * Raising the sun does not fix it either — 8x, 24x and 60x add only more
 * sparkle, because a sun is a POINT and a fractal's normals scatter, so
 * almost no pixel ever aims at it. Two things do:
 *
 *   - WIDENING the lobe rather than brightening it, `pow(sunDot, 24) * 0.35`
 *     becoming roughly `pow(sunDot, 1) * 2.0`. That is a softbox rather than
 *     a sun: it lights the whole facing hemisphere and leaves the room dark,
 *     which is how chrome is photographed in the first place. Worth
 *     +95.6/255 on the app's own backdrop, from two module constants.
 *   - A ROOM. The app already ships an infinite one-sided floor
 *     (`SURFACE_GROUND_PLANE`, composing with every core in both
 *     dimensions) and a backdrop that serves as sky; what neither does is
 *     EMIT. Give the floor radiance and the object lifts from mean 26.7 to
 *     97.2 before a single secondary ray is cast; give the sky radiance too
 *     and it reaches 145.0.
 *
 * So the environment work was never a half measure that tracing supersedes.
 * It is the INPUT tracing consumes, and it comes first.
 *
 * ── VERDICT 4: WHAT TRACING BUYS ONCE THE ROOM EXISTS ───────────────────
 *
 * Two things, neither reachable any other way. First, recesses that are
 * actually dark: an image-based reflection samples the environment along the
 * reflected ray with no idea whether anything is in the way, so pits read
 * LIGHTER than the surface around them, which is physically backwards. In
 * the full room the properly-dark fraction goes 1.0% -> 18.5% at one bounce.
 * Second, and this is the one no cheaper approach can reach at all: COLOUR
 * FROM ONE TRANSFORM ONTO ANOTHER. `Transform.finish` is per-transform, so a
 * system can carry metal maps beside saturated matte ones — but the shipped
 * BRDF's entire environment is the backdrop's two stops plus a sun, so a
 * chrome map can never show the colour of anything else in the scene. A
 * traced ray can.
 *
 * One bounce is most of it: environment -> 1 bounce measured 20.9/255 and
 * 1 -> 3 bounces 11.2/255 in the full room. And a mixed metal-and-matte
 * scene is substantially CHEAPER than an all-metal one, since a matte map
 * spawns no secondary rays at all — the same frame cost 2345s with one
 * chrome map against three matte and 4165s with all four metal.
 *
 * ── HOW THIS SHEET IS BUILT ────────────────────────────────────────────
 *
 * PRIMARY rays come from `de-preview.ts`'s shared marcher through its
 * shading hook — this file adds no second marcher. SECONDARY rays are local,
 * because no shared instrument can express them and that is the whole
 * subject. Every hit is lit by {@link shadeSurface}, which is
 * `finishShadeTs` term for term with exactly two substitutions — the
 * reflected direction takes its own normal, and the reflected radiance comes
 * from a {@link Room} rather than from the inlined sky lines — so at the
 * shipped constants with `nRefl === n` and no traced colour it reproduces
 * `finishShadeTs` EXACTLY. A test below pins that, so the copy cannot drift
 * (`surface-material.ts`'s duplicated `bulbPow8` and its diffing test are
 * the precedent). That equality is also the shape of the eventual shader
 * change: parameterize the glow constants, take a second normal, and let a
 * traced colour stand in for the environment lookup.
 *
 * Panels are small by default so the whole sheet runs inside the harness
 * timeout; the pictures that earned the verdicts above were the same scenes
 * at 260-300px with 4x supersampling and a gloss cone, and cost up to 69
 * minutes each on one core.
 */
import { describe, expect, it } from "vitest";
import {
  buildSurfaceDE,
  deHasFolds,
  estimateDistance,
  estimateDistanceRefined,
  type SurfaceDE,
} from "../src/fractal/surface-de";
import {
  buildBalloon,
  estimateBalloonDistance,
  invertBalloon,
  type Balloon,
} from "../src/fractal/balloon-de";
import {
  CLASSIC_SURFACE_FINISH,
  finishShadeTs,
  resolveSurfaceFinish,
  type ResolvedSurfaceFinish,
  type SurfaceFinishShadeEnv,
} from "../src/fractal/surface-finish";
import { mengerSponge } from "../src/fractal/presets";
import { DEFAULT_BACKGROUND, resolveBackground } from "../src/app/background";
import {
  PREVIEW_HIT,
  renderPreview,
  writeContactSheet,
  type PanelStats,
  type Vec3,
} from "./de-preview";

/* ── the shipped sun, copied because the constants are module-private ──
 * `surface-finish.ts` keeps SUN_DISC_TIGHTNESS and friends unexported, so
 * these are a COPY and {@link shadeSurface} is a copy of the body that
 * reads them. The pin test below is what stops either drifting. */
const SHIPPED_SUN = {
  discTightness: 400,
  discIntensity: 14,
  glowTightness: 24,
  glowIntensity: 0.35,
} as const;

const mix = (x: number, y: number, t: number): number => x * (1 - t) + y * t;
const dot3 = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** The marcher's own fixed light, mirrored from `de-preview.ts`. */
const LIGHT: Vec3 = norm([0.62, 0.78, 0.36]);

/** An emitting floor: the app's ground plane with radiance, which is the
 * one thing `SURFACE_GROUND_PLANE` does not have today. */
export interface Floor {
  /** World y of the plane. */
  y: number;
  /** Radiance scale — the plane is lit through its own up-facing normal. */
  lit: number;
  /** Checker cell size in world units; 0 for a plain floor. A mirror needs
   * STRUCTURE to read as a mirror rather than as paint. */
  checker: number;
  albedo: Vec3;
  /** Distance (world units) over which the floor fades to sky, so the plane
   * has a horizon instead of an infinite hard edge. */
  fade: number;
}

/** Everything a reflected ray can possibly see. The name is the point: with
 * an unlit room a tracer has nothing to carry. */
export interface Room {
  /** Backdrop stops as the tracers take them — sRGB-authored, decoded to
   * linear inside, exactly as the shipped body's `pow(envBase, 2.2)`. */
  bgTop: Vec3;
  bgBottom: Vec3;
  discTightness: number;
  discIntensity: number;
  glowTightness: number;
  glowIntensity: number;
  floor: Floor | null;
  /** DIAGNOSTIC only: a lat-long checkerboard sky at this cell count. A
   * mirror shows checkers; anything else does not. It answers "is the
   * reflection working, or is the environment simply featureless" without
   * any aesthetic judgement, and it is what produced verdict 1. */
  skyChecker?: number;
}

/** The app's own default backdrop, read LIVE rather than invented — this is
 * the environment the product actually ships, and measuring against a
 * brighter one is how an earlier pass flattered the baseline by ~70x. */
export function shippedRoom(): Room {
  const g = resolveBackground(DEFAULT_BACKGROUND);
  return {
    bgTop: [...g.top] as Vec3,
    bgBottom: [...g.bottom] as Vec3,
    ...SHIPPED_SUN,
    floor: null,
  };
}

/** The sky along a direction, in LINEAR radiance. Mirrors the shipped
 * body's horizon + sun lines; `pow(envBase, 2.2)` is why the stops arrive
 * sRGB-authored. */
export function skyRadiance(dir: Vec3, room: Room, light: Vec3): Vec3 {
  if (room.skyChecker) {
    const u = Math.atan2(dir[2], dir[0]) / Math.PI;
    const v = Math.asin(clamp01(dir[1] * 0.5 + 0.5) * 2 - 1) / (Math.PI / 2);
    const k =
      (Math.floor((u + 1) * room.skyChecker) +
        Math.floor((v + 1) * room.skyChecker)) &
      1;
    const c = k === 0 ? 0.85 : 0.02;
    return [c, c * 0.98, c * 0.95];
  }
  const horizon = clamp01(dir[1] * 0.5 + 0.5);
  const horizonT = horizon * horizon * (3 - 2 * horizon);
  const sunDot = Math.max(dot3(dir, light), 0);
  const sunAmt =
    Math.pow(sunDot, room.discTightness) * room.discIntensity +
    Math.pow(sunDot, room.glowTightness) * room.glowIntensity;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] =
      Math.pow(mix(room.bgBottom[i], room.bgTop[i], horizonT), 2.2) + sunAmt;
  }
  return out;
}

/** The floor along a ray, or null when the ray never reaches it. */
export function floorRadiance(
  o: Vec3,
  dir: Vec3,
  room: Room,
  light: Vec3,
): Vec3 | null {
  const f = room.floor;
  if (!f || dir[1] >= -1e-6) return null;
  const t = (f.y - o[1]) / dir[1];
  if (t <= 0) return null;
  const hx = o[0] + dir[0] * t;
  const hz = o[2] + dir[2] * t;
  let albedo = f.albedo;
  if (f.checker > 0) {
    const k = (Math.floor(hx / f.checker) + Math.floor(hz / f.checker)) & 1;
    albedo =
      k === 0
        ? f.albedo
        : ([
            f.albedo[0] * 0.22,
            f.albedo[1] * 0.22,
            f.albedo[2] * 0.22,
          ] as Vec3);
  }
  // Lit through the plane's own up-facing normal by the same light the
  // specular highlight reads, so the floor and the object agree.
  const e = f.lit * Math.max(light[1], 0);
  const sky = skyRadiance(dir, room, light);
  const g = Math.min(1, Math.hypot(hx - o[0], hz - o[2]) / f.fade);
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = mix(albedo[i] * e, sky[i], g * g);
  return out;
}

/** What a ray leaving `o` toward `dir` finds: the room's floor, else sky. */
export function envRadiance(o: Vec3, dir: Vec3, room: Room, light: Vec3): Vec3 {
  return floorRadiance(o, dir, room, light) ?? skyRadiance(dir, room, light);
}

/**
 * `finishShadeTs` with exactly two substitutions — the reflected direction
 * takes its OWN normal (`nRefl`, verdict 2) and the reflected radiance comes
 * from `reflRadiance` (a {@link Room} lookup, or a traced colour) instead of
 * the inlined sky lines. Everything else is that function's body in its own
 * operation order, so with `nRefl === n` and the shipped room this
 * reproduces it exactly — pinned below.
 */
export function shadeSurface(
  base: Vec3,
  n: Vec3,
  nRefl: Vec3,
  rd: Vec3,
  shadow: number,
  ao: number,
  bg: Vec3,
  finish: ResolvedSurfaceFinish,
  env: SurfaceFinishShadeEnv,
  reflRadiance: Vec3,
): Vec3 {
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
  const fresnel = f0 + (1 - f0) * Math.pow(1 - clamp01(dot3(n, negRd)), 5);
  const reflW = finish.reflect * fresnel;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const refl = reflW * metalTint[i] * reflRadiance[i];
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

/** `reflect(rd, n)` — the GLSL/WGSL intrinsic's definition. */
export function reflectDir(rd: Vec3, n: Vec3): Vec3 {
  const d = dot3(n, rd);
  return [rd[0] - 2 * d * n[0], rd[1] - 2 * d * n[1], rd[2] - 2 * d * n[2]];
}

/* ── the scene: a system, optionally ballooned, with per-slot materials ── */

/** A surface material: the five finish numbers plus the albedo they light. */
export interface Material {
  finish: ResolvedSurfaceFinish;
  albedo: Vec3;
}

const CHROME: Material = {
  finish: resolveSurfaceFinish({
    specular: 1,
    shininess: 96,
    metalness: 1,
    reflect: 0.9,
  }),
  albedo: [0.95, 0.95, 0.95],
};
const matte = (albedo: Vec3): Material => ({
  finish: resolveSurfaceFinish({ specular: 0.18, shininess: 16 }),
  albedo,
});

export interface Scene {
  de: (p: Vec3) => number;
  /** Which term won — the echo (`shell`) or the fractal. */
  shellAt: (p: Vec3) => boolean;
  /** Depth-0 base map of a point: the inverse landing nearest the bounding
   * centre. For a contractive IFS the copies are disjoint, so that is
   * exactly "which copy is this" — the descent's own first choice, which is
   * what `surface-slots.ts` keys a per-transform finish on. */
  baseIndexAt: (p: Vec3) => number;
  base: SurfaceDE;
  balloon: Balloon | null;
  /** Marching-ball radius and its centre. */
  R: number;
  target: Vec3;
  objR: number;
}

export function buildScene(rMult: number, ballMult: number): Scene {
  const base = buildSurfaceDE(mengerSponge(), null);
  const raw = deHasFolds(base) ? estimateDistance : estimateDistanceRefined;
  const balloon = rMult > 0 ? buildBalloon(base, rMult) : null;
  const query = (p: Vec3): { d: number; shell: boolean } =>
    balloon
      ? estimateBalloonDistance(raw, base, balloon, p)
      : { d: raw(base, p), shell: false };
  const objR = base.visibleBoundingRadius;
  return {
    de: (p) => query(p).d,
    shellAt: (p) => query(p).shell,
    baseIndexAt: (p) => {
      let best = -1;
      let bd = Infinity;
      for (const m of base.maps) {
        const M = m.invM;
        const t = m.invT;
        const qx =
          M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + t[0] - base.boundCenter[0];
        const qy =
          M[3] * p[0] + M[4] * p[1] + M[5] * p[2] + t[1] - base.boundCenter[1];
        const qz =
          M[6] * p[0] + M[7] * p[1] + M[8] * p[2] + t[2] - base.boundCenter[2];
        const d = qx * qx + qy * qy + qz * qz;
        if (d < bd) {
          bd = d;
          best = m.baseIndex;
        }
      }
      return best;
    },
    base,
    balloon,
    R: objR * ballMult,
    target: [...base.boundCenter] as Vec3,
    objR,
  };
}

/* ── secondary rays, which no shared instrument can express ────────────── */

export interface TraceOpts {
  room: Room;
  /** 0 = sample the environment without marching (the SHIPPED behaviour).
   * >0 = trace that many bounces, falling back to the room on a miss. */
  bounces: number;
  /** Reflection-normal tap width as a multiple of the pixel footprint. */
  normX: number;
  /** Per-slot materials, keyed by base map index; absent slots take
   * `fallback`. */
  slots?: Map<number, Material>;
  fallback: Material;
  size: number;
  zoom: number;
}

const MAX_SECONDARY_STEPS = 220;

function makeTracer(scene: Scene, opts: TraceOpts) {
  const { de } = scene;
  const eps = 0.0008 * scene.R;
  const far = scene.R * 2.2;
  const pixel = (1.1 / opts.size) * opts.zoom;
  const foot = (t: number): number =>
    Math.max(pixel * Math.max(t, 1), scene.R * 2e-4);
  const shadeEnv: SurfaceFinishShadeEnv = {
    lightDir: LIGHT,
    ambient: 0.18,
    envStrength: 0,
    bgTop: opts.room.bgTop,
    bgBottom: opts.room.bgBottom,
  };

  const normalAt = (p: Vec3, h: number): Vec3 =>
    norm([
      de([p[0] + h, p[1], p[2]]) - de([p[0] - h, p[1], p[2]]),
      de([p[0], p[1] + h, p[2]]) - de([p[0], p[1] - h, p[2]]),
      de([p[0], p[1], p[2] + h]) - de([p[0], p[1], p[2] - h]),
    ]);

  const march = (ro: Vec3, rd: Vec3): { p: Vec3; t: number } | null => {
    let t = eps * 3;
    for (let i = 0; i < MAX_SECONDARY_STEPS; i++) {
      const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
      if (
        Math.hypot(
          p[0] - scene.target[0],
          p[1] - scene.target[1],
          p[2] - scene.target[2],
        ) > far
      ) {
        return null;
      }
      const d = de(p);
      if (d < eps) return { p, t };
      t += Math.max(d * scene.base.stepScale, eps * 0.5);
    }
    return null;
  };

  const softShadow = (p: Vec3): number => {
    let t = eps * 6;
    let s = 1;
    for (let i = 0; i < 48; i++) {
      const d = de([
        p[0] + LIGHT[0] * t,
        p[1] + LIGHT[1] * t,
        p[2] + LIGHT[2] * t,
      ]);
      s = Math.min(s, (8 * d) / t);
      t += Math.max(d, eps);
      if (s < 0.03 || t > far) break;
    }
    return clamp01(s);
  };

  /** The material a point wears — attributed through the inversion on the
   * echo, since the shell is the reflection of the point that produced it
   * and the shipped balloon gives it that point's finish. */
  const matAt = (p: Vec3): Material => {
    if (!opts.slots) return opts.fallback;
    const q =
      scene.balloon && scene.shellAt(p) ? invertBalloon(scene.balloon, p) : p;
    return opts.slots.get(scene.baseIndexAt(q)) ?? opts.fallback;
  };

  const shade = (
    p: Vec3,
    n: Vec3,
    rd: Vec3,
    mat: Material,
    depth: number,
    path: number,
    shadow: number,
    ao: number,
    bg: Vec3,
  ): Vec3 => {
    const nRefl = opts.normX === 1 ? n : normalAt(p, opts.normX * foot(path));
    const r = norm(reflectDir(rd, nRefl));
    const o: Vec3 = [
      p[0] + nRefl[0] * eps * 4,
      p[1] + nRefl[1] * eps * 4,
      p[2] + nRefl[2] * eps * 4,
    ];
    let reflRadiance: Vec3;
    if (mat.finish.reflect <= 0) {
      reflRadiance = [0, 0, 0];
    } else if (depth >= opts.bounces) {
      reflRadiance = envRadiance(o, r, opts.room, LIGHT);
    } else {
      const hit = march(o, r);
      if (!hit) {
        reflRadiance = envRadiance(o, r, opts.room, LIGHT);
      } else {
        const hm = matAt(hit.p);
        const hn = normalAt(hit.p, foot(path + hit.t));
        // A reflected hit is shaded in full — its own normal, shadow and
        // reflection — and returns LINEAR radiance, so it is decoded back
        // out of the shade function's gamma encode.
        const enc = shade(
          hit.p,
          hn,
          r,
          hm,
          depth + 1,
          path + hit.t,
          softShadow(hit.p),
          1,
          bg,
        );
        reflRadiance = [
          Math.pow(enc[0], 2.2),
          Math.pow(enc[1], 2.2),
          Math.pow(enc[2], 2.2),
        ];
      }
    }
    return shadeSurface(
      mat.albedo,
      n,
      nRefl,
      rd,
      shadow,
      ao,
      bg,
      mat.finish,
      shadeEnv,
      reflRadiance,
    );
  };

  return { shade, matAt, normalAt, foot, march };
}

/** Render one panel, repainting every non-hit pixel from the SAME room the
 * reflection samples — a mirror showing a world the frame does not contain
 * is the fault that made the first prototype of this study unreadable. */
export function renderScene(scene: Scene, opts: TraceOpts): PanelStats {
  const tracer = makeTracer(scene, opts);
  const eye: Vec3 = [
    scene.target[0] + 1.05 * scene.R,
    scene.target[1] + 0.72 * scene.R,
    scene.target[2] + 1.2 * scene.R,
  ];
  const panel = renderPreview(
    {
      de: scene.de,
      boundingRadius: scene.R,
      target: scene.target,
      stepScale: scene.base.stepScale,
      eyeOffset: [1.05, 0.72, 1.2],
      zoom: opts.zoom,
      ao: true,
      shadow: true,
      fog: false,
      collect: true,
      shade: (hit) =>
        tracer.shade(
          hit.p,
          hit.n,
          hit.rd,
          tracer.matAt(hit.p),
          0,
          hit.t,
          hit.shadow,
          hit.ao,
          hit.bg,
        ),
    },
    opts.size,
  );
  // Background = the room, so the frame contains the world the mirror shows.
  const fwd = norm([
    scene.target[0] - eye[0],
    scene.target[1] - eye[1],
    scene.target[2] - eye[2],
  ]);
  const right = norm([-fwd[2], 0, fwd[0]]);
  const up: Vec3 = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const status = panel.status;
  if (status) {
    for (let py = 0; py < opts.size; py++) {
      for (let px = 0; px < opts.size; px++) {
        const i = py * opts.size + px;
        if (status[i] === PREVIEW_HIT) continue;
        const u = ((px + 0.5) / opts.size) * 2 - 1;
        const v = 1 - ((py + 0.5) / opts.size) * 2;
        const dir = norm([
          fwd[0] + opts.zoom * (u * right[0] + v * up[0]),
          fwd[1] + opts.zoom * (u * right[1] + v * up[1]),
          fwd[2] + opts.zoom * (u * right[2] + v * up[2]),
        ]);
        const c = envRadiance(eye, dir, opts.room, LIGHT);
        for (let k = 0; k < 3; k++) {
          panel.rgb[i * 3 + k] = Math.max(
            0,
            Math.min(
              255,
              Math.round(255 * Math.pow(Math.max(c[k], 0), 1 / 2.2)),
            ),
          );
        }
      }
    }
  }
  return panel;
}

/* ── metrics: what a panel is, in numbers ──────────────────────────────── */

const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

export interface PanelMetrics {
  /** Fraction of the frame the object covers. */
  coverage: number;
  /** Mean luminance over object pixels — "is there any light here at all". */
  meanL: number;
  /** Fraction of object pixels below luminance 16 — recesses that read as
   * recesses. An image-based reflection cannot produce these. */
  darkFraction: number;
  /** Mean |ΔL| between horizontally adjacent object pixels. Reported
   * rather than asserted on: it conflates STATIC with sharp EDGES, and a
   * reflection that has become coherent enough to show a checkerboard gains
   * crisp boundaries exactly as it stops being noise. */
  localContrast: number;
  /** Fraction of adjacent object pixel pairs disagreeing by more than 32.
   * THIS is the static measure: a shattered reflection jumps at nearly
   * every pair, while a coherent one jumps only at its few real edges. */
  noiseFraction: number;
  /** COHERENCE, `1 - lag1/lag4`, over the same jump threshold. Static
   * disagrees as often at one pixel as at four, so the ratio is ~1 and
   * coherence ~0; an image agrees with its immediate neighbour far more
   * often than with a distant one. It is scale-free, which is what neither
   * `localContrast` nor `noiseFraction` was — both conflate static with the
   * real edges a resolving reflection GAINS. */
  coherence: number;
}

export function panelMetrics(panel: PanelStats): PanelMetrics {
  const { rgb, width: w, status } = panel;
  if (!status) throw new Error("panelMetrics needs collect: true");
  let n = 0;
  let sum = 0;
  let dark = 0;
  let contrast = 0;
  let noisy = 0;
  let pairs = 0;
  let far = 0;
  let farPairs = 0;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (status[i] !== PREVIEW_HIT) continue;
      const L = luminance(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
      n++;
      sum += L;
      if (L < 16) dark++;
      if (x + 4 < w && status[i + 4] === PREVIEW_HIT) {
        const L4 = luminance(
          rgb[(i + 4) * 3],
          rgb[(i + 4) * 3 + 1],
          rgb[(i + 4) * 3 + 2],
        );
        if (Math.abs(L4 - L) > 32) far++;
        farPairs++;
      }
      if (x + 1 < w && status[i + 1] === PREVIEW_HIT) {
        const L2 = luminance(
          rgb[(i + 1) * 3],
          rgb[(i + 1) * 3 + 1],
          rgb[(i + 1) * 3 + 2],
        );
        const dL = Math.abs(L2 - L);
        contrast += dL;
        if (dL > 32) noisy++;
        pairs++;
      }
    }
  }
  return {
    coverage: n / (w * w),
    meanL: n ? sum / n : 0,
    darkFraction: n ? dark / n : 0,
    localContrast: pairs ? contrast / pairs : 0,
    noiseFraction: pairs ? noisy / pairs : 0,
    coherence:
      pairs && farPairs && far > 0 ? 1 - noisy / pairs / (far / farPairs) : 0,
  };
}

/** Mean absolute difference over pixels BOTH panels call object. */
export function panelDelta(a: PanelStats, b: PanelStats): number {
  const sa = a.status;
  const sb = b.status;
  if (!sa || !sb) throw new Error("panelDelta needs collect: true");
  let n = 0;
  let sum = 0;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== PREVIEW_HIT || sb[i] !== PREVIEW_HIT) continue;
    n++;
    sum +=
      (Math.abs(a.rgb[i * 3] - b.rgb[i * 3]) +
        Math.abs(a.rgb[i * 3 + 1] - b.rgb[i * 3 + 1]) +
        Math.abs(a.rgb[i * 3 + 2] - b.rgb[i * 3 + 2])) /
      3;
  }
  return n ? sum / n : 0;
}

function report(label: string, m: PanelMetrics, ms: number): void {
  console.log(
    `  ${label.padEnd(34)} meanL ${m.meanL.toFixed(1).padStart(5)}  ` +
      `dark ${(100 * m.darkFraction).toFixed(1).padStart(5)}%  ` +
      `noise ${(100 * m.noiseFraction).toFixed(1).padStart(5)}%  ` +
      `coherence ${m.coherence.toFixed(3).padStart(6)}  ` +
      `localContrast ${m.localContrast.toFixed(1).padStart(5)}  ` +
      `cover ${(100 * m.coverage).toFixed(1).padStart(5)}%  ${ms}ms`,
  );
}

/* ── the sheet ─────────────────────────────────────────────────────────── */

const SIZE = 150;
/** The checkerboard diagnostic renders LARGER than the rest of the sheet,
 * and that is not a detail. Its whole content is whether a human can see an
 * image in the reflection or only static, and at the sheet's default size
 * the metric still reads the difference (coherence 0.050 -> 0.127) while the
 * PICTURE does not — the panels come out as speckle at every filter width.
 * A sheet that a reader cannot judge has failed at the one job a sheet has. */
const CHECKER_SIZE = 230;
const ZOOM = 0.55;
const R_MULT = 0.7;
const BALL = 2.0;

const softboxRoom = (): Room => ({
  ...shippedRoom(),
  glowTightness: 1,
  glowIntensity: 2.0,
});
const fullRoom = (scene: Scene, checker: number): Room => ({
  ...softboxRoom(),
  floor: {
    y: scene.target[1] - 2.2 * scene.objR,
    lit: 1.4,
    checker: checker * scene.objR,
    albedo: [0.72, 0.72, 0.7],
    fade: 14 * scene.objR,
  },
});
const base = (over: Partial<TraceOpts>): TraceOpts => ({
  room: shippedRoom(),
  bounces: 0,
  normX: 1,
  fallback: CHROME,
  size: SIZE,
  zoom: ZOOM,
  ...over,
});

function timed(scene: Scene, opts: TraceOpts, label: string) {
  const t0 = Date.now();
  const panel = renderScene(scene, opts);
  const m = panelMetrics(panel);
  report(label, m, Date.now() - t0);
  return { panel, m };
}

describe("finish reflection sheet", () => {
  it("shadeSurface reproduces finishShadeTs exactly at the shipped constants", () => {
    // The copy-cannot-drift pin. With nRefl === n and the reflected radiance
    // taken from the room's own sky lines, this file's shading function IS
    // the shipped one — which is what makes every panel below a measurement
    // of the product rather than of an approximation to it.
    const room = shippedRoom();
    const env: SurfaceFinishShadeEnv = {
      lightDir: LIGHT,
      ambient: 0.18,
      envStrength: 0.25,
      bgTop: room.bgTop,
      bgBottom: room.bgBottom,
    };
    const finishes = [
      CLASSIC_SURFACE_FINISH,
      resolveSurfaceFinish({
        specular: 1,
        shininess: 96,
        metalness: 1,
        reflect: 0.9,
      }),
      resolveSurfaceFinish({
        specular: 0.9,
        shininess: 96,
        reflect: 0.35,
        transmit: 0.75,
      }),
      resolveSurfaceFinish({ specular: 0.25, shininess: 8, reflect: 0.08 }),
    ];
    const normals: Vec3[] = [
      [0, 1, 0],
      norm([0.3, -0.8, 0.5]),
      norm([-0.7, 0.2, -0.6]),
    ];
    const dirs: Vec3[] = [norm([0.2, -0.3, -1]), norm([-0.9, -0.1, -0.4])];
    const bases: Vec3[] = [
      [0.95, 0.95, 0.95],
      [0.88, 0.22, 0.16],
      [0.1, 0.4, 0.7],
    ];
    let cases = 0;
    for (const finish of finishes) {
      for (const n of normals) {
        for (const rd of dirs) {
          for (const b of bases) {
            for (const shadow of [1, 0.4]) {
              const bg: Vec3 = [0.05, 0.06, 0.09];
              const want = finishShadeTs(
                b,
                n,
                rd,
                shadow,
                0.8,
                bg,
                finish,
                env,
              );
              const got = shadeSurface(
                b,
                n,
                n,
                rd,
                shadow,
                0.8,
                bg,
                finish,
                env,
                skyRadiance(reflectDir(rd, n), room, LIGHT),
              );
              for (let i = 0; i < 3; i++) {
                expect(got[i], `channel ${i}`).toBe(want[i]);
              }
              cases++;
            }
          }
        }
      }
    }
    console.log(`  pinned ${cases} cases against finishShadeTs, exactly`);
  });

  it("verdict 1+2: a fractal mirror resolves the environment but does not ARRANGE it", () => {
    const scene = buildScene(R_MULT, BALL);
    // The decisive test, and it is the claim stated directly rather than a
    // texture statistic (two of those failed here first, because a COHERENT
    // checkerboard reflection jumps at every tile boundary exactly as a
    // shattered one jumps everywhere — neither adjacent-pixel contrast nor a
    // jump count can tell those apart).
    //
    // If a mirror on this geometry integrates the whole environment and
    // returns its mean, then replacing a checkerboard sky with a UNIFORM sky
    // of the same mean radiance must change almost nothing. If the mirror
    // resolves the environment instead, the two must differ. So the number
    // to read is the delta between those two panels, at each filter width.
    const checker: Room = { ...shippedRoom(), skyChecker: 8 };
    // The checker's own mean radiance, as a flat sky: both stops set to the
    // sRGB value whose 2.2 decode is the mean of 0.85 and 0.02 linear.
    const flat = Math.pow((0.85 + 0.02) / 2, 1 / 2.2);
    const uniform: Room = {
      ...shippedRoom(),
      bgTop: [flat, flat * 0.99, flat * 0.975],
      bgBottom: [flat, flat * 0.99, flat * 0.975],
      discIntensity: 0,
      glowIntensity: 0,
    };
    const widths = [1, 3, 8, 20];
    const panels: PanelStats[] = [];
    const resolved: number[] = [];
    const coherences: number[] = [];
    for (let i = 0; i < widths.length; i++) {
      const normX = widths[i];
      const { panel } = timed(
        scene,
        base({ room: checker, bounces: 1, normX, size: CHECKER_SIZE }),
        `checker sky, reflection normal ${normX}x pixel`,
      );
      panels.push(panel);
      coherences.push(panelMetrics(panel).coherence);
      // The uniform-sky twin only has to establish that the resolved figure
      // is FLAT, so it runs at the ENDPOINTS rather than at every rung — the
      // four checker panels are the sheet, and doubling them would put this
      // block past the harness timeout on a slower machine.
      if (i === 0 || i === widths.length - 1) {
        const { panel: flatPanel } = timed(
          scene,
          base({ room: uniform, bounces: 1, normX, size: CHECKER_SIZE }),
          `  ...same, uniform sky of equal mean`,
        );
        resolved.push(panelDelta(panel, flatPanel));
      }
    }
    console.log(
      `  HOW MUCH OF THE ENVIRONMENT THE MIRROR RESOLVES (checker vs its own mean): ` +
        `${widths[0]}x ${resolved[0].toFixed(1)}/255  ->  ` +
        `${widths[widths.length - 1]}x ${resolved[1].toFixed(1)}/255`,
    );
    console.log(
      `  HOW COHERENTLY IT ARRANGES WHAT IT RESOLVES: ` +
        coherences
          .map((x, i) => `${widths[i]}x ${x.toFixed(3)}`)
          .join("  ->  "),
    );
    // AND THE CORRECTION THIS TEST FORCED, which is worth more than the
    // assertion: the resolution figure above comes out FLAT across the
    // sweep. An unfiltered fractal mirror does NOT return the environment's
    // mean — each pixel carries a real, correct sample of it. What it lacks
    // is ARRANGEMENT: neighbouring pixels sample far-apart directions, so
    // the image is scrambled rather than averaged. (Averaging IS what
    // supersampling then does to it, which is why 16 samples per pixel
    // converge to flat grey — that is the same fact one level up.) So
    // filtering the reflection normal recovers no information at all. It
    // recovers COHERENCE: the same signal, arranged into a picture.
    const peak = Math.max(...coherences);
    const peakAt = widths[coherences.indexOf(peak)];
    console.log(`  coherence peaks at ${peakAt}x (${peak.toFixed(3)})`);
    // The assertion is that filtering WORKS, not WHERE it peaks. Where it
    // peaks moves with the panel size (verdict 2b), so pinning the location
    // here would pin an artefact of CHECKER_SIZE and would break the moment
    // anyone changed it — which is exactly how this was discovered.
    expect(
      peak,
      "filtering the reflection normal did not make the reflection coherent",
    ).toBeGreaterThan(coherences[0] * 2);
    // And the refutation, pinned so it cannot quietly revert: how much of
    // the environment the mirror resolves does NOT change with the filter.
    const spread = Math.max(...resolved) - Math.min(...resolved);
    expect(
      spread,
      "filtering changed how much environment is resolved",
    ).toBeLessThan(2);
    console.log(
      `  wrote ${writeContactSheet(panels, widths.length, "finish-reflection-normal.png")}`,
    );
  });

  it("verdict 3: a tracer transports light, it does not create it", () => {
    // The headline, and the one every earlier sheet missed by rendering
    // against a brighter instrument backdrop than the product ships.
    const scene = buildScene(R_MULT, BALL);
    const shipped = shippedRoom();
    const dark = timed(
      scene,
      base({ room: shipped }),
      "shipped room, environment only",
    );
    const darkTraced = timed(
      scene,
      base({ room: shipped, bounces: 1, normX: 12 }),
      "shipped room, 1 traced bounce",
    );
    const softbox = timed(
      scene,
      base({ room: softboxRoom(), normX: 12 }),
      "softbox sky, environment only",
    );
    const room = fullRoom(scene, 2.5);
    // THE FILTER AND THE TRACER FIGHT EACH OTHER, which is why this is a
    // ladder rather than a single pair. A wider reflection-normal tap makes
    // neighbouring rays more parallel, so more of them escape to the room
    // and the self-occlusion tracing exists to compute is smoothed away.
    // Too narrow and the mirror is static (verdict 2); too wide and tracing
    // stops paying. There is a window, and it is not a free parameter.
    const litLadder = [3, 6, 12, 20].map((normX) => {
      const envOnly = timed(
        scene,
        base({ room, normX }),
        `full room, environment only, normal ${normX}x`,
      );
      const traced = timed(
        scene,
        base({ room, bounces: 1, normX }),
        `full room, 1 traced bounce, normal ${normX}x`,
      );
      return {
        normX,
        envOnly,
        traced,
        delta: panelDelta(envOnly.panel, traced.panel),
      };
    });
    console.log(
      `  WHAT TRACING BUYS AGAINST FILTER WIDTH: ` +
        litLadder
          .map((r) => `${r.normX}x ${r.delta.toFixed(1)}/255`)
          .join("  ->  "),
    );
    const best = litLadder.reduce((a, b) => (b.delta > a.delta ? b : a));
    const lit = best.envOnly;
    const litTraced = best.traced;
    const nullResult = panelDelta(dark.panel, darkTraced.panel);
    console.log(
      `  TRACING AN UNLIT ROOM MOVED ${nullResult.toFixed(2)}/255 — ` +
        `mean luminance ${dark.m.meanL.toFixed(1)} -> ${darkTraced.m.meanL.toFixed(1)}`,
    );
    console.log(
      `  LIGHTING THE ROOM MOVED IT ${(lit.m.meanL - dark.m.meanL).toFixed(1)} of mean luminance, ` +
        `before a single secondary ray`,
    );
    console.log(
      `  tracing the LIT room moved ${best.delta.toFixed(2)}/255 at its best filter width (${best.normX}x)`,
    );
    // Tracing an unlit room is a near-no-op: there is nothing to carry.
    expect(nullResult).toBeLessThan(12);
    // Lighting it is not.
    expect(softbox.m.meanL).toBeGreaterThan(dark.m.meanL + 40);
    expect(lit.m.meanL).toBeGreaterThan(dark.m.meanL + 60);
    // And the verdict itself, stated as a comparison rather than as an
    // absolute: the SAME tracer over the SAME geometry does far more in a
    // lit room than in an unlit one, because in the unlit one there is
    // nothing for it to carry.
    expect(
      best.delta,
      "tracing did no more in a lit room than in an unlit one",
    ).toBeGreaterThan(nullResult * 2);
    console.log(
      `  wrote ${writeContactSheet(
        [
          dark.panel,
          darkTraced.panel,
          softbox.panel,
          lit.panel,
          litTraced.panel,
        ],
        5,
        "finish-reflection-room.png",
      )}`,
    );
  });

  it("verdict 4: only a traced ray carries one transform's colour onto another", () => {
    const scene = buildScene(R_MULT, BALL);
    const room = fullRoom(scene, 2.5);
    // Per-transform finishes are what the feature IS: metal maps beside
    // saturated matte ones. The shipped BRDF's whole environment is the
    // backdrop, so a chrome map cannot show a neighbour's colour; a bounce
    // can. Slots cycle by base map index over the sponge's twenty.
    const palette: Vec3[] = [
      [0.69, 0.16, 0.12],
      [0.1, 0.5, 0.55],
      [0.85, 0.57, 0.13],
    ];
    const slots = new Map<number, Material>();
    for (let i = 0; i < scene.base.maps.length; i++) {
      const k = scene.base.maps[i].baseIndex;
      slots.set(k, k % 4 === 0 ? CHROME : matte(palette[k % 3]));
    }
    const opts = base({ room, normX: 20, slots });
    const envOnly = timed(scene, opts, "metal + colour, environment only");
    const oneBounce = timed(
      scene,
      { ...opts, bounces: 1 },
      "metal + colour, 1 bounce",
    );
    const threeBounce = timed(
      scene,
      { ...opts, bounces: 3 },
      "metal + colour, 3 bounces",
    );
    const d1 = panelDelta(envOnly.panel, oneBounce.panel);
    const d3 = panelDelta(oneBounce.panel, threeBounce.panel);
    console.log(
      `  environment -> 1 bounce ${d1.toFixed(2)}/255, 1 -> 3 bounces ${d3.toFixed(2)}/255 ` +
        `(one bounce is ${((100 * d1) / (d1 + d3)).toFixed(0)}% of the change)`,
    );
    // One bounce carries most of it; the rest is inter-reflection in the
    // deepest recesses.
    expect(d1).toBeGreaterThan(d3);
    expect(oneBounce.m.darkFraction).toBeGreaterThan(envOnly.m.darkFraction);
    console.log(
      `  wrote ${writeContactSheet(
        [envOnly.panel, oneBounce.panel, threeBounce.panel],
        3,
        "finish-reflection-colour.png",
      )}`,
    );
  });
});
