/**
 * Shared CPU sphere-tracer for the distance-estimator harnesses.
 *
 * The numeric harnesses answer "is the estimate sound and how much does it
 * cost". This answers the one they cannot: WHAT DOES IT LOOK LIKE. A wrong
 * convention, a sign slip, or a formula that is simply dull all survive
 * every tolerance check as some consistent object; none survive a picture.
 *
 * Deliberately NOT a re-implementation of the shipped tracers — no tiers, no
 * strips, no grid, no palette LUTs. It is the smallest marcher that renders
 * a DE honestly (tetrahedron normals, Quilez cone-traced soft shadow, a
 * cheap step-count AO, fog, sRGB out), so that two formulas rendered through
 * it differ ONLY in the formula. Identical shading is the whole point: it is
 * what lets a comparison sheet carry a verdict about the objects rather than
 * about their lighting.
 *
 * `chain-speckle.harness.ts` added the INSTRUMENTS, purely additively: a
 * settable step budget, switches for the two shading terms that read the
 * marcher's own statistics rather than the object (the step-count AO
 * stand-in and the cone-traced shadow), an always-counted `exhausted` tally,
 * and opt-in per-pixel status/hit-position/step arrays. Every default
 * reproduces the pre-existing panels byte for byte — the point of that
 * harness is that a speckled sheet has three possible causes and the
 * defaults cannot tell them apart.
 *
 * `finish-pattern.harness.ts` added the one hook the fixed lighting could
 * not be bent into: an optional per-hit SHADING callback
 * (`PreviewScene.shade`), handed the normal, shadow and AO the marcher
 * already computed, so a sheet about SURFACE FINISH lights every hit with
 * the shipped composition (`surface-finish.ts`'s `finishShadeTs`) rather
 * than this file's fixed approximation of one. Absent — every other
 * consumer — the fixed path runs textually unchanged.
 *
 * Consumers: `escape-family-preview.harness.ts`, `escape-chain.harness.ts`,
 * `chain-speckle.harness.ts`, `escape-form-sweep.harness.ts`,
 * `bulb-preview.harness.ts`, `hybrid-chain.harness.ts`,
 * `qjulia-beauty.harness.ts`, `qjulia-preview.harness.ts` and
 * `finish-pattern.harness.ts` take the whole thing; `julia-flame.harness.ts`
 * takes `encodePng` alone and assembles its own sheet (its panel stats do
 * not fit `writeContactSheet`'s shape).
 *
 * KEEPING THAT LIST HONEST IS PART OF THE POINT, and it was wrong once:
 * `qjulia-preview.harness.ts` predates this module and had hand-rolled both
 * a tracer and a byte-for-byte copy of the PNG encoder below, with
 * independently drifted shading constants — so its sheet was not comparable
 * with the rest of the family's while this list claimed it as a user. A
 * pre-merge review caught both halves; the harness now renders through
 * `renderPreview` like its siblings.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Vec3 = [number, number, number];

/** A distance estimator, already bound to whatever system it renders. */
export type DistanceEstimator = (p: Vec3) => number;

export interface PreviewScene {
  de: DistanceEstimator;
  /** The marching ball: rays enter and exit against it, centred on `target`. */
  boundingRadius: number;
  /** What the camera looks at, and the centre of the bounding ball. */
  target?: Vec3;
  /**
   * March step damping. 1.0 for a conformal estimate, 0.35 for the fold
   * family's heuristic — see `escape-de.ts`'s `ESCAPE_STEP_SCALE`.
   */
  stepScale: number;
  /**
   * Camera offset from `target`, in units of `boundingRadius`. Its MAGNITUDE
   * must exceed 1 or the eye sits inside the marching ball (and usually
   * inside the object, which renders a solid-colour panel at ~100% hits —
   * the first thing to check when a preview comes out flat).
   */
  eyeOffset?: Vec3;
  /** Half-angle spread of the frustum; smaller = tighter framing. */
  zoom?: number;
  /**
   * Per-ray march step budget. Defaults to {@link DEFAULT_MAX_STEPS} — the
   * one every panel drawn before `chain-speckle.harness.ts` used, so leaving
   * it unset reproduces those sheets byte for byte. Raise it to ask whether
   * a speckled render is STARVED rather than fine (`PanelStats.exhausted` is
   * the answer).
   */
  maxSteps?: number;
  /**
   * The step-count AO stand-in (default on). It is a PROXY — "this ray took
   * many steps, so it sits in a crease" — and on a fold DE the step count
   * swings hard between neighbouring pixels, so the proxy manufactures
   * pixel-scale contrast of its own. Off isolates the object's shape from
   * the harness's shading heuristic.
   */
  ao?: boolean;
  /** The Quilez cone-traced soft shadow (default on). Off with {@link ao}
   * leaves normal-based lighting alone, which is the shading with the least
   * of the marcher's own step statistics baked into it. */
  shadow?: boolean;
  /** Fill {@link PanelStats}'s per-pixel arrays. Off by default so no
   * existing multi-panel sheet pays the allocation. */
  collect?: boolean;
  /**
   * Per-hit SHADING HOOK (default absent). When set, the marcher still
   * does everything it did — march, tetrahedron normal, cone-traced
   * shadow, step-count AO — and then hands that {@link PreviewHit} to the
   * hook instead of running its own fixed lighting, so a sheet can light
   * every hit with a REAL composition (`surface-finish.ts`'s
   * `finishShadeTs` over a patterned albedo, say) rather than a ninth
   * approximation of one. The hook returns the pixel's pre-fog color in the
   * OUTPUT (gamma-encoded) space — the shipped tracers' `finishShade`
   * convention, which encodes inside the shade function and fogs LAST in
   * encoded space — and the marcher then fogs it toward the encoded
   * backdrop and writes the bytes without a second encode. Absent, the
   * fixed lighting path below runs textually unchanged, so every panel
   * drawn before the hook existed reproduces byte for byte.
   */
  shade?: (hit: PreviewHit) => Vec3;
}

/** What {@link PreviewScene.shade} is handed for one hit pixel. */
export interface PreviewHit {
  /** Pixel coordinates of the hit, so a hook can keep per-pixel maps of
   * whatever it computes (the marcher visits pixels in scanline order, but
   * a hook should not have to rely on that). */
  px: number;
  py: number;
  /** The surface point, in the marcher's own frame (a zoomed-by-similarity
   * estimator's caller un-scales it). */
  p: Vec3;
  /** Tetrahedron-technique normal at `p`. */
  n: Vec3;
  /** Unit ray direction, eye -> `p`. */
  rd: Vec3;
  /** Ray parameter of the hit (distance from the eye). */
  t: number;
  /** The marcher's fixed light direction (unit). */
  light: Vec3;
  /** Cone-traced soft shadow in `[0, 1]` — `1` when {@link PreviewScene.shadow}
   * is off. */
  shadow: number;
  /** The step-count AO stand-in in `[0.25, 1]` — `1` when
   * {@link PreviewScene.ao} is off. */
  ao: number;
  /** Steps the primary ray spent reaching `p`. */
  steps: number;
  /** The pixel's own backdrop in the OUTPUT (gamma-encoded) space — what a
   * miss at this pixel writes — so a hook can pass it as the `bg` a
   * transmissive finish blends toward. */
  bg: Vec3;
}

/** Per-pixel terminal state in {@link PanelStats.status}. */
export const PREVIEW_MISS = 0;
export const PREVIEW_HIT = 1;
/** Ran out of {@link PreviewScene.maxSteps} still inside the marching ball —
 * the direct fingerprint of an UNDER-BUDGETED march, as against an object
 * that is genuinely finer than the pixel grid. */
export const PREVIEW_EXHAUSTED = 2;

export interface PanelStats {
  rgb: Uint8Array;
  width: number;
  height: number;
  hits: number;
  evals: number;
  steps: number;
  ms: number;
  /** Rays that spent the whole step budget without hitting or leaving the
   * marching ball. */
  exhausted: number;
  /** Set when {@link PreviewScene.collect}: `PREVIEW_MISS|HIT|EXHAUSTED`. */
  status?: Uint8Array;
  /** Set when {@link PreviewScene.collect}: the surface point of every hit
   * pixel (3 floats per pixel, zero elsewhere), so a caller can evaluate a
   * per-hit quantity — an orbit trap, say — without re-marching. */
  hitPos?: Float32Array;
  /** Set when {@link PreviewScene.collect}: steps the primary ray spent. */
  stepCount?: Uint16Array;
}

/** The step budget every panel predating `chain-speckle.harness.ts` marched
 * with, and still the default. */
export const DEFAULT_MAX_STEPS = 600;
/** Backdrop: a quiet vertical gradient, so silhouettes read. Exported (in
 * the marcher's LINEAR space — `gam` them for output space) so a shading
 * hook can hand the same two stops to a composition that samples its
 * environment off the backdrop, as the shipped tracers' does. */
export const PREVIEW_BG_TOP: Vec3 = [0.1, 0.12, 0.16];
export const PREVIEW_BG_BOTTOM: Vec3 = [0.04, 0.045, 0.06];
const MAX_STEPS = DEFAULT_MAX_STEPS;
/** Step count at which the step-count AO stand-in bottoms out. Must track
 * MAX_STEPS: a DE that needs many small steps is not automatically occluded,
 * and tying this to a fixed count crushes fold renders to black. */
const AO_REFERENCE_STEPS = 150;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** The output encode, one channel: linear -> the sRGB-ish 1/2.2 gamma every
 * panel has always been written with (quantization stays at the write). */
const gam = (x: number): number => Math.pow(Math.max(0, x), 1 / 2.2);

/** Tetrahedron-technique normal — the four taps every shipped tracer uses. */
function normalAt(de: DistanceEstimator, p: Vec3, h: number): Vec3 {
  const k: Vec3[] = [
    [1, -1, -1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, 1, 1],
  ];
  let n: Vec3 = [0, 0, 0];
  for (const s of k) {
    const d = de([p[0] + s[0] * h, p[1] + s[1] * h, p[2] + s[2] * h]);
    n = [n[0] + s[0] * d, n[1] + s[1] * d, n[2] + s[2] * d];
  }
  return norm(n);
}

/** Quilez soft shadow by DE cone tracing. */
function softShadow(
  de: DistanceEstimator,
  p: Vec3,
  l: Vec3,
  eps: number,
  reach: number,
  stepScale: number,
): number {
  let res = 1;
  let t = eps * 8;
  for (let i = 0; i < 56 && t < reach; i++) {
    const d = de([p[0] + l[0] * t, p[1] + l[1] * t, p[2] + l[2] * t]);
    if (d < eps) return 0;
    res = Math.min(res, (10 * d) / t);
    t += Math.max(d * stepScale, eps);
  }
  return res;
}

/** Render one square panel of a scene. */
export function renderPreview(scene: PreviewScene, size: number): PanelStats {
  const started = Date.now();
  const target = scene.target ?? [0, 0, 0];
  const R = scene.boundingRadius;
  const off = scene.eyeOffset ?? [1.55, 1.1, 1.8];
  const eye: Vec3 = [
    target[0] + off[0] * R,
    target[1] + off[1] * R,
    target[2] + off[2] * R,
  ];
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const zoom = scene.zoom ?? 0.55;
  const light = norm([0.62, 0.78, 0.36]);

  const maxSteps = scene.maxSteps ?? MAX_STEPS;
  const wantAo = scene.ao ?? true;
  const wantShadow = scene.shadow ?? true;
  const rgb = new Uint8Array(size * size * 3);
  const status = scene.collect ? new Uint8Array(size * size) : undefined;
  const hitPos = scene.collect ? new Float32Array(size * size * 3) : undefined;
  const stepCount = scene.collect ? new Uint16Array(size * size) : undefined;
  let hits = 0;
  let evals = 0;
  let steps = 0;
  let exhausted = 0;
  const bgTop = PREVIEW_BG_TOP;
  const bgBot = PREVIEW_BG_BOTTOM;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = ((px + 0.5) / size) * 2 - 1;
      const v = 1 - ((py + 0.5) / size) * 2;
      const dir = norm([
        fwd[0] + zoom * (u * right[0] + v * up[0]),
        fwd[1] + zoom * (u * right[1] + v * up[1]),
        fwd[2] + zoom * (u * right[2] + v * up[2]),
      ]);

      const g = (py + 0.5) / size;
      let col: Vec3 = [
        bgTop[0] + (bgBot[0] - bgTop[0]) * g,
        bgTop[1] + (bgBot[1] - bgTop[1]) * g,
        bgTop[2] + (bgBot[2] - bgTop[2]) * g,
      ];
      // Set by the shading hook: `col` is already in output space.
      let encoded = false;

      const o = sub(eye, target);
      const b = dot(o, dir);
      const cc = dot(o, o) - R * R;
      const disc = b * b - cc;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        let t = Math.max(0, -b - sq);
        const tEnd = -b + sq;
        const eps = (1.1 / size) * zoom;
        let hit = false;
        let used = 0;
        for (; used < maxSteps && t < tEnd; used++) {
          const p: Vec3 = [
            eye[0] + dir[0] * t,
            eye[1] + dir[1] * t,
            eye[2] + dir[2] * t,
          ];
          const d = scene.de(p);
          evals++;
          if (d < eps * Math.max(t, 1)) {
            hit = true;
            break;
          }
          t += Math.max(d * scene.stepScale, eps * 0.5);
        }
        steps += used;
        const spent = used >= maxSteps && t < tEnd && !hit;
        if (spent) exhausted++;
        if (status) {
          status[py * size + px] = hit
            ? PREVIEW_HIT
            : spent
              ? PREVIEW_EXHAUSTED
              : PREVIEW_MISS;
        }
        if (stepCount) stepCount[py * size + px] = Math.min(used, 65535);
        if (hit) {
          hits++;
          const p: Vec3 = [
            eye[0] + dir[0] * t,
            eye[1] + dir[1] * t,
            eye[2] + dir[2] * t,
          ];
          if (hitPos) {
            const at = (py * size + px) * 3;
            hitPos[at] = p[0];
            hitPos[at + 1] = p[1];
            hitPos[at + 2] = p[2];
          }
          const h = eps * Math.max(t, 1);
          const n = normalAt(scene.de, p, h);
          const lift: Vec3 = [
            p[0] + n[0] * h * 2,
            p[1] + n[1] * h * 2,
            p[2] + n[2] * h * 2,
          ];
          const diff = Math.max(0, dot(n, light));
          const sh = wantShadow
            ? softShadow(scene.de, lift, light, h, R * 1.5, scene.stepScale)
            : 1;
          // Step count stands in for AO: deep steppers sit in creases.
          const ao = wantAo ? Math.max(0.25, 1 - used / AO_REFERENCE_STEPS) : 1;
          const fog = Math.min(1, Math.max(0, (t - R * 0.5) / (R * 2.4)));
          if (scene.shade) {
            // Hook path: the caller lights the hit in OUTPUT space (see
            // PreviewScene.shade); fog mixes toward the encoded backdrop
            // and the byte write below skips the encode.
            const shaded = scene.shade({
              px,
              py,
              p,
              n,
              rd: dir,
              t,
              light,
              shadow: sh,
              ao,
              steps: used,
              bg: [gam(col[0]), gam(col[1]), gam(col[2])],
            });
            const fogTo: Vec3 = [gam(bgBot[0]), gam(bgBot[1]), gam(bgBot[2])];
            col = [
              shaded[0] + (fogTo[0] - shaded[0]) * fog,
              shaded[1] + (fogTo[1] - shaded[1]) * fog,
              shaded[2] + (fogTo[2] - shaded[2]) * fog,
            ];
            encoded = true;
          } else {
            const sky = 0.5 + 0.5 * n[1];
            const lit = 0.16 * sky * ao + 0.92 * diff * sh;
            const half = norm([
              n[0] + light[0],
              n[1] + light[1],
              n[2] + light[2],
            ]);
            const spec =
              Math.pow(
                Math.max(0, dot(half, norm([-dir[0], -dir[1], -dir[2]]))),
                28,
              ) *
              sh *
              0.35;
            col = [
              lit * (0.98 + 0.3 * n[0]) + spec,
              lit * (0.8 + 0.12 * n[1]) + spec,
              lit * (0.6 + 0.42 * n[2]) + spec,
            ];
            col = [
              col[0] + (bgBot[0] - col[0]) * fog,
              col[1] + (bgBot[1] - col[1]) * fog,
              col[2] + (bgBot[2] - col[2]) * fog,
            ];
          }
        }
      }

      const enc = (x: number) =>
        Math.max(0, Math.min(255, Math.round(255 * gam(x))));
      const quant = (x: number) =>
        Math.max(0, Math.min(255, Math.round(255 * x)));
      const idx = (py * size + px) * 3;
      rgb[idx] = encoded ? quant(col[0]) : enc(col[0]);
      rgb[idx + 1] = encoded ? quant(col[1]) : enc(col[1]);
      rgb[idx + 2] = encoded ? quant(col[2]) : enc(col[2]);
    }
  }
  return {
    rgb,
    width: size,
    height: size,
    hits,
    evals,
    steps,
    exhausted,
    status,
    hitPos,
    stepCount,
    ms: Date.now() - started,
  };
}

// ------------------------------------------------------------- PNG output

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(
  width: number,
  height: number,
  rgb: Uint8Array,
): Buffer {
  const stride = 1 + width * 3;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * stride + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(chunk("IHDR", ihdr)),
    Buffer.from(chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 })))),
    Buffer.from(chunk("IEND", new Uint8Array(0))),
  ]);
}

/** Tile square panels into a grid and write it beside the harnesses. */
export function writeContactSheet(
  panels: PanelStats[],
  cols: number,
  fileName: string,
): string {
  const size = panels[0].width;
  const rows = Math.ceil(panels.length / cols);
  const sheetW = size * cols;
  const sheet = new Uint8Array(sheetW * size * rows * 3);
  panels.forEach((panel, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    for (let y = 0; y < size; y++) {
      const src = y * size * 3;
      const dst = ((row * size + y) * sheetW + col * size) * 3;
      sheet.set(panel.rgb.subarray(src, src + size * 3), dst);
    }
  });
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, fileName);
  writeFileSync(file, encodePng(sheetW, size * rows, sheet));
  return file;
}
