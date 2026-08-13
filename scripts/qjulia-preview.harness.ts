/**
 * fr-7u8t.4 visual proof: march `qjulia-de.ts`'s oracle on the CPU and write
 * the image out.
 *
 * The unit tests pin the estimator's SOUNDNESS (no overshoot at step scale
 * 1.0) and its CONJUGACY (the rendered set is the classic set translated by
 * `-c`), but neither answers the question that de-risks the rest of the
 * epic: does the estimator actually resolve a quaternion Julia set that
 * looks like the published ones? A wrong real-part convention, a `|v|`/`|y|`
 * mix-up, or a sign slip in the quaternion square all survive the numeric
 * tests as *some* consistent object; they do not survive a picture.
 *
 * This is also the reference image the GPU cores (fr-7u8t.5) are eyeballed
 * against — the `flame-gpu.ts` oracle discipline's visual half, the same
 * role `fold-phantom.harness.ts` plays for the fold descents.
 *
 * MEASURED VERDICT, and it is a product finding rather than a numeric one:
 * quaternion Julia sets of `q² + c` are SMOOTH. Every such set is a solid of
 * revolution — any quaternion `c` is carried to a COMPLEX `c` by a rotation
 * of the imaginary 3-space, which is an automorphism of the quaternions, so
 * membership depends only on `(x, y, |(z, w)|)` and no choice of constant
 * escapes the lathe. The classic renders (Hart 1989, Crane 2005) look like
 * turned wood for exactly this reason. That is worth knowing before the
 * epic's later beads: this object is fast, mathematically clean and
 * genuinely 4D, but it is NOT where the intricate "3D fractal landscape"
 * look comes from — that is the Mandelbulb/Mandelbox family (fr-7u8t.7).
 * The panels below are chosen to show the real range, dendrite constants
 * included, so the judgement is made from pictures rather than from the
 * brief's framing.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/qjulia-preview.harness.ts
 * Writes: `scripts/out/qjulia-preview.png` (a contact sheet).
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildQJuliaDE,
  estimateQJuliaDistance,
  QJULIA_STEP_SCALE,
} from "../src/fractal/qjulia-de";
import type { QJuliaDE } from "../src/fractal/qjulia-de";
import type { Transform, Vec4 } from "../src/fractal/types";

const PANEL_W = 420;
const PANEL_H = 420;
const MAX_STEPS = 220;

/** One pure quaternion square whose translation is the Julia constant. */
function qjuliaSystem(c: Vec4): Transform {
  return {
    id: 1,
    position: [c[0], c[1], c[2]],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "qsquare", weight: 1 }],
    ...(c[3] === 0 ? {} : { w: { position: c[3], scale: 1 } }),
  };
}

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The DE at a 3D point on the `w = w0` slice. */
function de3(de: QJuliaDE, p: Vec3, w0: number): number {
  return estimateQJuliaDistance(de, [p[0], p[1], p[2], w0]);
}

/** Tetrahedron-technique normal — the same four taps the tracers use. */
function normalAt(de: QJuliaDE, p: Vec3, w0: number, h: number): Vec3 {
  const k: Vec3[] = [
    [1, -1, -1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, 1, 1],
  ];
  let n: Vec3 = [0, 0, 0];
  for (const s of k) {
    const d = de3(de, [p[0] + s[0] * h, p[1] + s[1] * h, p[2] + s[2] * h], w0);
    n = [n[0] + s[0] * d, n[1] + s[1] * d, n[2] + s[2] * d];
  }
  return norm(n);
}

/** Quilez soft shadow via DE cone tracing. */
function shadow(de: QJuliaDE, p: Vec3, l: Vec3, w0: number, eps: number) {
  let res = 1;
  let t = eps * 8;
  for (let i = 0; i < 48 && t < 4; i++) {
    const d = de3(de, [p[0] + l[0] * t, p[1] + l[1] * t, p[2] + l[2] * t], w0);
    if (d < eps) return 0;
    res = Math.min(res, (12 * d) / t);
    t += Math.max(d * QJULIA_STEP_SCALE, eps);
  }
  return res;
}

interface Panel {
  label: string;
  c: Vec4;
  w0: number;
}

function renderPanel(panel: Panel): {
  rgb: Uint8Array;
  hits: number;
  evals: number;
  orbit: number;
} {
  const de = buildQJuliaDE([qjuliaSystem(panel.c)]);
  // The set is the classic one translated by -c, so it centres near -c.
  const target: Vec3 = [-panel.c[0], -panel.c[1], -panel.c[2]];
  const eye: Vec3 = [target[0] + 2.1, target[1] + 1.5, target[2] + 2.4];
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);

  const rgb = new Uint8Array(PANEL_W * PANEL_H * 3);
  let hits = 0;
  let evals = 0;
  let orbit = 0;
  const light = norm([0.6, 0.8, 0.35]);

  for (let py = 0; py < PANEL_H; py++) {
    for (let px = 0; px < PANEL_W; px++) {
      const u = ((px + 0.5) / PANEL_W) * 2 - 1;
      const v = 1 - ((py + 0.5) / PANEL_H) * 2;
      const dir = norm([
        fwd[0] + 0.55 * (u * right[0] + v * up[0]),
        fwd[1] + 0.55 * (u * right[1] + v * up[1]),
        fwd[2] + 0.55 * (u * right[2] + v * up[2]),
      ]);

      // Sphere gate against the DE's own bounding ball (centred at origin).
      const b = dot(eye, dir);
      const cc = dot(eye, eye) - de.boundingRadius * de.boundingRadius;
      const disc = b * b - cc;
      let r = 0.07;
      let g = 0.08;
      let bl = 0.11;
      if (disc >= 0) {
        let t = Math.max(0, -b - Math.sqrt(disc));
        const tEnd = -b + Math.sqrt(disc);
        // Pixel-footprint epsilon, as the tracers do.
        const eps = (1.6 / PANEL_W) * 0.9;
        let hit = false;
        let steps = 0;
        for (; steps < MAX_STEPS && t < tEnd; steps++) {
          const p: Vec3 = [
            eye[0] + dir[0] * t,
            eye[1] + dir[1] * t,
            eye[2] + dir[2] * t,
          ];
          const d = de3(de, p, panel.w0);
          evals++;
          if (d < eps * Math.max(t, 1)) {
            hit = true;
            break;
          }
          t += Math.max(d * QJULIA_STEP_SCALE, eps * 0.5);
        }
        orbit += steps;
        if (hit) {
          hits++;
          const p: Vec3 = [
            eye[0] + dir[0] * t,
            eye[1] + dir[1] * t,
            eye[2] + dir[2] * t,
          ];
          const h = eps * Math.max(t, 1);
          const n = normalAt(de, p, panel.w0, h);
          const diff = Math.max(0, dot(n, light));
          const sh = shadow(
            de,
            [p[0] + n[0] * h * 2, p[1] + n[1] * h * 2, p[2] + n[2] * h * 2],
            light,
            panel.w0,
            h,
          );
          // Cheap iteration-count AO stand-in: deep steppers sit in creases.
          const ao = Math.max(0.25, 1 - steps / 90);
          const sky = 0.5 + 0.5 * n[1];
          const lit = 0.14 * sky * ao + 0.95 * diff * sh;
          const spec =
            Math.pow(
              Math.max(
                0,
                dot(
                  norm([n[0] + light[0], n[1] + light[1], n[2] + light[2]]),
                  norm([-dir[0], -dir[1], -dir[2]]),
                ),
              ),
              24,
            ) *
            sh *
            0.4;
          // Warm-to-cool by facing, so form reads without a palette.
          r = lit * (0.95 + 0.35 * n[0]) + spec;
          g = lit * (0.78 + 0.1 * n[1]) + spec;
          bl = lit * (0.62 + 0.45 * n[2]) + spec;
          // Fog toward the backdrop.
          const fog = Math.min(1, Math.max(0, (t - 1.6) / 4));
          r += (0.07 - r) * fog;
          g += (0.08 - g) * fog;
          bl += (0.11 - bl) * fog;
        }
      }
      const o = (py * PANEL_W + px) * 3;
      // sRGB out, matching the app's authored-sRGB convention.
      const enc = (x: number) =>
        Math.max(
          0,
          Math.min(255, Math.round(255 * Math.pow(Math.max(0, x), 1 / 2.2))),
        );
      rgb[o] = enc(r);
      rgb[o + 1] = enc(g);
      rgb[o + 2] = enc(bl);
    }
  }
  return { rgb, hits, evals, orbit };
}

// ---------------------------------------------------------------- PNG out

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

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    raw.set(
      rgb.subarray(y * width * 3, (y + 1) * width * 3),
      y * (1 + width * 3) + 1,
    );
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

describe("fr-7u8t.4 quaternion Julia CPU preview", () => {
  it("marches the oracle and writes a contact sheet", () => {
    const panels: Panel[] = [
      // Interior constants: the smooth lathe form the module doc describes.
      {
        label: "c=(-0.2,0.6,0.2,0) w0=0 — interior constant",
        c: [-0.2, 0.6, 0.2, 0],
        w0: 0,
      },
      {
        label: "same c, w0=0.35 — a different 4D slice",
        c: [-0.2, 0.6, 0.2, 0],
        w0: 0.35,
      },
      // Douady rabbit: the most structured connected quadratic Julia set.
      {
        label: "c=(-0.123,0.745,0,0) — Douady rabbit",
        c: [-0.123, 0.745, 0, 0],
        w0: 0,
      },
      // On the boundary / outside: dendrites and dust, where the set is at
      // its most intricate and the smoothness claim is under most pressure.
      { label: "c=(0,1,0,0) — dendrite", c: [0, 1, 0, 0], w0: 0 },
      {
        label: "c=(-0.75,0.02,0,0) — San Marco (parabolic)",
        c: [-0.75, 0.02, 0, 0],
        w0: 0,
      },
      {
        label: "c=(-0.4,0.6,0,0.25) — 4D constant, sliced at w0=0.15",
        c: [-0.4, 0.6, 0, 0.25],
        w0: 0.15,
      },
    ];

    const COLS = 3;
    const rows = Math.ceil(panels.length / COLS);
    const sheetW = PANEL_W * COLS;
    const sheet = new Uint8Array(sheetW * PANEL_H * rows * 3);
    panels.forEach((panel, i) => {
      const started = Date.now();
      const { rgb, hits, evals, orbit } = renderPanel(panel);
      const ms = Date.now() - started;
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      for (let y = 0; y < PANEL_H; y++) {
        const src = y * PANEL_W * 3;
        const dst = ((row * PANEL_H + y) * sheetW + col * PANEL_W) * 3;
        sheet.set(rgb.subarray(src, src + PANEL_W * 3), dst);
      }
      console.log(
        `  panel ${i}  ${panel.label}\n` +
          `    hits ${hits}/${PANEL_W * PANEL_H} (${((hits / (PANEL_W * PANEL_H)) * 100).toFixed(1)}%)  ` +
          `DE evals ${evals}  march steps/ray ${(orbit / (PANEL_W * PANEL_H)).toFixed(1)}  ${ms}ms`,
      );
      expect(hits).toBeGreaterThan(0.02 * PANEL_W * PANEL_H);
    });

    const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, "qjulia-preview.png");
    writeFileSync(file, encodePng(sheetW, PANEL_H * rows, sheet));
    console.log(`  wrote ${file}`);
  });
});
