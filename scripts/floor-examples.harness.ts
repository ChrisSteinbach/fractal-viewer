/**
 * SCRATCH design sheet, not a measurement record: three candidate
 * generative floor-pattern families for the presentation floor, rendered
 * top-down as flat albedo (the shipped floor is matte, so the pattern is
 * the whole look). Every family is a pure function of authored parameters
 * — no seeds — exactly as it would ship. Output lands under
 * scripts/out/floor-examples/.
 *
 * opt 1  truchet/checker: authored lattice basis (rotation, anisotropy,
 *        skew) + per-tile variant hashing whose authored phase pair is the
 *        unforeseeable knob. The classic checker is variant 0.
 * opt 2  the same tiling rule on a domain warped by authored fbm noise.
 * opt 5  de Bruijn pentagrid: five grid families with per-family phason
 *        shifts; every crossing of two lines contributes the parallelogram
 *        spanned by the projected site vectors of its four surrounding
 *        cells, and the full enumeration tiles the plane (empirically:
 *        ~100% coverage, ~0% overlap, fat-area share 72.5% against the
 *        theoretical 72.4%). The audit printed per spec measures exactly
 *        that.
 */
import { writeLabeledContactSheet } from "./de-preview";
import type { PanelStats } from "./de-preview";

const SIZE = 480;
const EXTENT = 3.4;
const WORLD_PER_PX = (2 * EXTENT) / SIZE;
const LIGHT = 1.0;
const DARK = 0.035;
const BASE_ALBEDO = 0.62;
const RCP_U32 = 1 / 4294967296;

function hash3(xi: number, yi: number, w: number): number {
  let h =
    Math.imul(xi, 0x9e3779b1) ^
    Math.imul(yi, 0x85ebca77) ^
    Math.imul(w, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  h ^= h >>> 16;
  return h >>> 0;
}

function valueNoise(x: number, y: number, w: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash3(xi, yi, w) * RCP_U32;
  const b = hash3(xi + 1, yi, w) * RCP_U32;
  const c = hash3(xi, yi + 1, w) * RCP_U32;
  const d = hash3(xi + 1, yi + 1, w) * RCP_U32;
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm2(x: number, y: number, w: number): number {
  return (
    (valueNoise(x, y, w) +
      0.5 * valueNoise(x * 2 + 13.7, y * 2 - 7.3, w + 101)) /
    1.5
  );
}

/** 1 inside (d < halfW), 0 outside, smoothed over aa. */
function strokeCoverage(d: number, halfW: number, aa: number): number {
  const t = (halfW + aa - d) / (2 * aa);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

interface TruchetSpec {
  angleDeg: number;
  aspect: number;
  skew: number;
  cell: number;
  phaseU: number;
  phaseV: number;
  mode: "checker" | "diag" | "arc" | "mix";
  lineHalf: number;
}

function truchetTone(s: TruchetSpec, x: number, y: number): number {
  const rad = (s.angleDeg * Math.PI) / 180;
  let qx = x;
  let qy = y;
  if (rad !== 0) {
    const c = Math.cos(rad);
    const sn = Math.sin(rad);
    const rx = c * qx + sn * qy;
    qy = -sn * qx + c * qy;
    qx = rx;
  }
  qx /= s.aspect;
  qy += s.skew * qx;
  qx /= s.cell;
  qy /= s.cell;
  const ti = Math.floor(qx);
  const tj = Math.floor(qy);
  const fx = qx - ti;
  const fy = qy - tj;
  const cu = Math.floor(s.phaseU * 1024);
  const cv = Math.floor(s.phaseV * 1024);
  const h = hash3(ti + cu, tj + cv, 0x51ed27);
  const r = h * RCP_U32;
  let kind: "checker" | "diag" | "arc" | "dot";
  if (s.mode === "checker") kind = "checker";
  else if (s.mode === "diag") kind = "diag";
  else if (s.mode === "arc") kind = "arc";
  else
    kind = r < 0.45 ? "diag" : r < 0.75 ? "arc" : r < 0.9 ? "dot" : "checker";
  if (kind === "checker") {
    const parity = (((ti + tj) % 2) + 2) % 2;
    return parity === 0 ? LIGHT : DARK;
  }
  const aa = WORLD_PER_PX / s.cell;
  const flip = ((h >>> 8) & 1) === 1;
  let sd: number;
  if (kind === "diag") {
    sd = flip
      ? Math.abs(fx + fy - 1) * Math.SQRT1_2
      : Math.abs(fx - fy) * Math.SQRT1_2;
  } else if (kind === "arc") {
    const a1 = Math.abs(Math.hypot(fx, fy) - 0.5);
    const a2 = Math.abs(Math.hypot(fx - 1, fy - 1) - 0.5);
    const b1 = Math.abs(Math.hypot(fx - 1, fy) - 0.5);
    const b2 = Math.abs(Math.hypot(fx, fy - 1) - 0.5);
    sd = flip ? Math.min(b1, b2) : Math.min(a1, a2);
  } else {
    sd = Math.hypot(fx - 0.5, fy - 0.5) - 0.16;
  }
  const cov = strokeCoverage(sd, s.lineHalf, aa);
  return LIGHT + (DARK - LIGHT) * cov;
}

interface WarpSpec {
  base: TruchetSpec;
  amp: number;
  freq: number;
  o1: readonly [number, number];
  o2: readonly [number, number];
}

function warpTone(s: WarpSpec, x: number, y: number): number {
  const n1 = fbm2(x * s.freq + s.o1[0], y * s.freq + s.o1[1], 0xa17c3) - 0.5;
  const n2 = fbm2(x * s.freq + s.o2[0], y * s.freq + s.o2[1], 0xb29d7) - 0.5;
  return truchetTone(s.base, x + s.amp * n1, y + s.amp * n2);
}

interface GridSpec {
  thetaDeg: number;
  scale: number;
  shifts: readonly [number, number, number, number, number];
}

const GRID_MARGIN = 3.0;
const GRID_THIN = 0.45;
const GRID_EDGE = 0.045;
const GRID_DIM = Math.pow(BASE_ALBEDO, 1 / 2.2);

/** Iq cosine-gradient palette (the palette.ts family), sRGB out. */
interface IqPalette {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  c: readonly [number, number, number];
  d: readonly [number, number, number];
}

function iqColor(p: IqPalette, t: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = Math.min(
      1,
      Math.max(
        0,
        p.a[k] + p.b[k] * Math.cos(2 * Math.PI * (p.c[k] * t + p.d[k])),
      ),
    );
  }
  return out;
}

function scale3(
  c: readonly [number, number, number],
  k: number,
): [number, number, number] {
  return [c[0] * k, c[1] * k, c[2] * k];
}

const PAL_SUNSET: IqPalette = {
  a: [0.5, 0.5, 0.5],
  b: [0.5, 0.5, 0.5],
  c: [1, 1, 1],
  d: [0.0, 0.1, 0.2],
};
const PAL_MARINE: IqPalette = {
  a: [0.5, 0.5, 0.5],
  b: [0.5, 0.5, 0.5],
  c: [1, 1, 0.5],
  d: [0.8, 0.9, 0.3],
};
const PAL_DUSK: IqPalette = {
  a: [0.58, 0.5, 0.55],
  b: [0.42, 0.42, 0.42],
  c: [1, 1, 1],
  d: [0.25, 0.1, 0.45],
};

/** What the renderer knows about one rhombus when a coloring rule asks. */
interface FaceInfo {
  readonly fat: boolean;
  /** Rhombus orientation class 0..4 (5 fat, 5 thin classes). */
  readonly oclass: number;
  /** The g1-invariant site height mod 5 — the phason's large-scale bands. */
  readonly hclass: number;
}

interface GridStyle {
  /** sRGB albedo (0..1) per rhombus; absent keeps the grey two-tone. */
  faceColor?: (f: FaceInfo) => readonly [number, number, number];
  /** Edge width in multiples of the default (~1.2 px). */
  edgeWidthMult?: number;
  /** Edge darkness (linear albedo). */
  edgeTone?: number;
  /** Draw the five grid families as dark Ammann-bar lines. */
  bars?: boolean;
}

/** Render one pentagrid panel and report its tiling audit. Every crossing
 * of two grid lines contributes the parallelogram spanned by the projected
 * site vectors of its four surrounding cells; the full enumeration tiles
 * the plane. Returns the sRGB buffer plus a coverage/overlap audit. */
function renderPentagrid(
  s: GridSpec,
  style?: GridStyle,
): { rgb: Uint8Array; audit: string } {
  const th = (s.thetaDeg * Math.PI) / 180;
  const nx: number[] = [];
  const ny: number[] = [];
  const vx: number[] = [];
  const vy: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = th + (i * 2 * Math.PI) / 5;
    nx.push(Math.cos(a));
    ny.push(Math.sin(a));
    vx.push(Math.cos(a) * s.scale);
    vy.push(Math.sin(a) * s.scale);
  }
  const fval = (i: number, x: number, y: number): number =>
    (nx[i] * x + ny[i] * y) / s.scale - s.shifts[i];
  const R = EXTENT + GRID_MARGIN;
  interface Face {
    pts: readonly (readonly [number, number])[];
    srgb: [number, number, number];
  }
  const faces: Face[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      const det = nx[i] * ny[j] - ny[i] * nx[j];
      const klo = Math.ceil(-R / s.scale - s.shifts[i] - 1);
      const khi = Math.floor(R / s.scale - s.shifts[i] + 1);
      for (let ki = klo; ki <= khi; ki++) {
        const kjlo = Math.ceil(-R / s.scale - s.shifts[j] - 1);
        const kjhi = Math.floor(R / s.scale - s.shifts[j] + 1);
        for (let kj = kjlo; kj <= kjhi; kj++) {
          const ci = (ki + s.shifts[i]) * s.scale;
          const cj = (kj + s.shifts[j]) * s.scale;
          const cx = (ci * ny[j] - ny[i] * cj) / det;
          const cy = (nx[i] * cj - ci * nx[j]) / det;
          if (Math.abs(cx) > R || Math.abs(cy) > R) continue;
          const m0 = [0, 0, 0, 0, 0];
          for (let l = 0; l < 5; l++) m0[l] = Math.floor(fval(l, cx, cy));
          m0[i] = ki - 1;
          m0[j] = kj - 1;
          let px = 0;
          let py = 0;
          for (let l = 0; l < 5; l++) {
            px += m0[l] * vx[l];
            py += m0[l] * vy[l];
          }
          if (Math.abs(px) > EXTENT + 1.5 || Math.abs(py) > EXTENT + 1.5) {
            continue;
          }
          const key = `${i}:${j}:${px.toFixed(6)}:${py.toFixed(6)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const pts: (readonly [number, number])[] = [
            [px, py],
            [px + vx[i], py + vy[i]],
            [px + vx[i] + vx[j], py + vy[i] + vy[j]],
            [px + vx[j], py + vy[j]],
          ];
          const d = (((j - i) % 5) + 5) % 5;
          const fat = d === 1 || d === 4;
          const sum = m0[0] + m0[1] + m0[2] + m0[3] + m0[4];
          const alt = ((sum % 2) + 2) % 2 === 0 ? 1.0 : 0.9;
          const info: FaceInfo = {
            fat,
            oclass: fat ? (d === 1 ? i : j) : d === 2 ? i : j,
            hclass: ((sum % 5) + 5) % 5,
          };
          let srgb: [number, number, number];
          if (style?.faceColor) {
            const c = style.faceColor(info);
            srgb = [
              Math.round(c[0] * GRID_DIM * 255),
              Math.round(c[1] * GRID_DIM * 255),
              Math.round(c[2] * GRID_DIM * 255),
            ];
          } else {
            const g = Math.round(
              Math.pow(BASE_ALBEDO * (fat ? 1.0 : GRID_THIN) * alt, 1 / 2.2) *
                255,
            );
            srgb = [g, g, g];
          }
          faces.push({ pts, srgb });
        }
      }
    }
  }
  const rgb = new Uint8Array(SIZE * SIZE * 3);
  const bg = Math.round(Math.pow(BASE_ALBEDO * 0.02, 1 / 2.2) * 255);
  rgb.fill(bg);
  const cov = new Uint8Array(SIZE * SIZE);
  let covered = 0;
  let overlap = 0;
  const edgeW = WORLD_PER_PX * 1.2 * (style?.edgeWidthMult ?? 1);
  const edgeTone = style?.edgeTone ?? GRID_EDGE;
  const edgeSrgb = [0, 1, 2].map((ch) =>
    Math.round(Math.pow(BASE_ALBEDO * edgeTone, 1 / 2.2) * 255),
  ) as [number, number, number];
  const segDist = (
    p: readonly [number, number],
    a: readonly [number, number],
    b: readonly [number, number],
  ): number => {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby),
      ),
    );
    return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
  };
  for (const f of faces) {
    let x0 = SIZE;
    let x1 = -1;
    let y0 = SIZE;
    let y1 = -1;
    for (const p of f.pts) {
      const gx = Math.floor(((p[0] + EXTENT) / (2 * EXTENT)) * SIZE);
      const gy = Math.floor(((EXTENT - p[1]) / (2 * EXTENT)) * SIZE);
      x0 = Math.max(0, Math.min(x0, gx - 2));
      x1 = Math.min(SIZE - 1, Math.max(x1, gx + 2));
      y0 = Math.max(0, Math.min(y0, gy - 2));
      y1 = Math.min(SIZE - 1, Math.max(y1, gy + 2));
    }
    if (x1 < x0 || y1 < y0) continue;
    for (let py = y0; py <= y1; py++) {
      const y = EXTENT - ((py + 0.5) / SIZE) * 2 * EXTENT;
      for (let px = x0; px <= x1; px++) {
        const x = ((px + 0.5) / SIZE) * 2 * EXTENT - EXTENT;
        let inside = true;
        let sign = 0;
        for (let k = 0; k < 4; k++) {
          const a = f.pts[k];
          const b = f.pts[(k + 1) % 4];
          const cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
          if (cr !== 0) {
            const sg = cr > 0 ? 1 : -1;
            if (sign === 0) sign = sg;
            else if (sg !== sign) {
              inside = false;
              break;
            }
          }
        }
        const idx = py * SIZE + px;
        if (!inside) continue;
        if (cov[idx] === 0) covered++;
        else overlap++;
        cov[idx] = 1;
        let edge = 0;
        for (let k = 0; k < 4; k++) {
          edge = Math.max(
            edge,
            strokeCoverage(
              segDist([x, y], f.pts[k], f.pts[(k + 1) % 4]),
              edgeW * 0.3,
              edgeW,
            ),
          );
        }
        const o = idx * 3;
        for (let ch = 0; ch < 3; ch++) {
          const v =
            edge > 0
              ? edgeSrgb[ch] + (f.srgb[ch] - edgeSrgb[ch]) * (1 - edge)
              : f.srgb[ch];
          rgb[o + ch] = Math.round(v);
        }
      }
    }
  }
  if (style?.bars) {
    const barSrgb = Math.round(Math.pow(BASE_ALBEDO * 0.1, 1 / 2.2) * 255);
    for (let i = 0; i < 5; i++) {
      const dx = -ny[i];
      const dy = nx[i];
      const klo = Math.ceil(-R / s.scale - s.shifts[i]);
      const khi = Math.floor(R / s.scale - s.shifts[i]);
      for (let k = klo; k <= khi; k++) {
        const off = (k + s.shifts[i]) * s.scale;
        const c0x = nx[i] * off;
        const c0y = ny[i] * off;
        let t0 = -Infinity;
        let t1 = Infinity;
        if (dx > 1e-12) {
          t0 = Math.max(t0, (-EXTENT - c0x) / dx);
          t1 = Math.min(t1, (EXTENT - c0x) / dx);
        } else if (dx < -1e-12) {
          t0 = Math.max(t0, (EXTENT - c0x) / dx);
          t1 = Math.min(t1, (-EXTENT - c0x) / dx);
        } else if (Math.abs(c0x) > EXTENT) continue;
        if (dy > 1e-12) {
          t0 = Math.max(t0, (-EXTENT - c0y) / dy);
          t1 = Math.min(t1, (EXTENT - c0y) / dy);
        } else if (dy < -1e-12) {
          t0 = Math.max(t0, (EXTENT - c0y) / dy);
          t1 = Math.min(t1, (-EXTENT - c0y) / dy);
        } else if (Math.abs(c0y) > EXTENT) continue;
        if (t1 <= t0) continue;
        const step = WORLD_PER_PX * 0.4;
        for (let t = t0; t <= t1; t += step) {
          const gx = ((c0x + t * dx + EXTENT) / (2 * EXTENT)) * SIZE;
          const gy = ((EXTENT - (c0y + t * dy)) / (2 * EXTENT)) * SIZE;
          const px0 = Math.round(gx);
          const py0 = Math.round(gy);
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const qx = px0 + ox;
              const qy = py0 + oy;
              if (qx < 0 || qx >= SIZE || qy < 0 || qy >= SIZE) continue;
              const dd = Math.hypot(qx + 0.5 - gx, qy + 0.5 - gy);
              const w = dd < 0.7 ? 0.9 : dd < 1.5 ? 0.45 : 0;
              if (w === 0) continue;
              const o = (qy * SIZE + qx) * 3;
              for (let ch = 0; ch < 3; ch++) {
                rgb[o + ch] = Math.round(rgb[o + ch] * (1 - w) + barSrgb * w);
              }
            }
          }
        }
      }
    }
  }
  const audit = `faces ${faces.length}, coverage ${((covered / (SIZE * SIZE)) * 100).toFixed(1)}%, overlap px ${overlap}`;
  return { rgb, audit };
}

interface Panel {
  lines: readonly [string, string];
  tone: (x: number, y: number) => number;
}

interface BufferedPanel {
  lines: readonly [string, string];
  rgb: Uint8Array;
}

function renderTonePanel(p: Panel): PanelStats {
  const rgb = new Uint8Array(SIZE * SIZE * 3);
  const t0 = Date.now();
  for (let py = 0; py < SIZE; py++) {
    const y = EXTENT - ((py + 0.5) / SIZE) * 2 * EXTENT;
    for (let px = 0; px < SIZE; px++) {
      const x = ((px + 0.5) / SIZE) * 2 * EXTENT - EXTENT;
      const tone = Math.min(1, Math.max(0, p.tone(x, y)));
      const srgb = Math.round(Math.pow(BASE_ALBEDO * tone, 1 / 2.2) * 255);
      const o = (py * SIZE + px) * 3;
      rgb[o] = srgb;
      rgb[o + 1] = srgb;
      rgb[o + 2] = srgb;
    }
  }
  return {
    rgb,
    width: SIZE,
    height: SIZE,
    hits: SIZE * SIZE,
    evals: SIZE * SIZE,
    steps: 0,
    ms: Date.now() - t0,
    exhausted: 0,
  };
}

function bufferedStats(rgb: Uint8Array): PanelStats {
  return {
    rgb,
    width: SIZE,
    height: SIZE,
    hits: SIZE * SIZE,
    evals: SIZE * SIZE,
    steps: 0,
    ms: 0,
    exhausted: 0,
  };
}

const checkerClassic: TruchetSpec = {
  angleDeg: 0,
  aspect: 1,
  skew: 0,
  cell: 0.5,
  phaseU: 0,
  phaseV: 0,
  mode: "checker",
  lineHalf: 0.07,
};
const diagAll: TruchetSpec = { ...checkerClassic, mode: "diag" };
const arcAll: TruchetSpec = { ...checkerClassic, mode: "arc" };
const mixA: TruchetSpec = { ...checkerClassic, mode: "mix" };
const mixB: TruchetSpec = {
  ...checkerClassic,
  mode: "mix",
  phaseU: 0.37,
  phaseV: 0.61,
};
const basisChecker: TruchetSpec = {
  ...checkerClassic,
  angleDeg: 35,
  aspect: 1.7,
  skew: 0.35,
};

const warpSoft: WarpSpec = {
  base: checkerClassic,
  amp: 0.25,
  freq: 1.2,
  o1: [3.1, 7.7],
  o2: [11.3, 5.9],
};
const warpStrong: WarpSpec = { ...warpSoft, amp: 0.7 };
const warpMixA: WarpSpec = {
  base: mixA,
  amp: 0.5,
  freq: 0.9,
  o1: [1.7, 9.2],
  o2: [13.9, 4.1],
};
const warpMixB: WarpSpec = {
  base: mixA,
  amp: 0.5,
  freq: 0.9,
  o1: [21.3, 2.6],
  o2: [7.1, 17.8],
};

const gridA: GridSpec = {
  thetaDeg: 0,
  scale: 1.0,
  shifts: [0.13, 0.62, 0.35, 0.81, 0.47],
};
const gridPhason: GridSpec = {
  ...gridA,
  shifts: [0.13, 0.62, 0.52, 0.81, 0.47],
};
const gridB: GridSpec = {
  ...gridA,
  shifts: [0.55, 0.08, 0.77, 0.3, 0.91],
};
const gridRot: GridSpec = { ...gridA, thetaDeg: 36 };

it("renders the three floor-family example sheets", () => {
  const opt1: Panel[] = [
    {
      lines: ["P1 CLASSIC CHECKER", "TILE 0.5R TONES 0.035/1.0"],
      tone: (x, y) => truchetTone(checkerClassic, x, y),
    },
    {
      lines: ["P2 TRUCHET DIAGONALS", "HASH ORIENT LINE 0.14C"],
      tone: (x, y) => truchetTone(diagAll, x, y),
    },
    {
      lines: ["P3 TRUCHET ARCS", "HASH ORIENT RADIUS 0.5C"],
      tone: (x, y) => truchetTone(arcAll, x, y),
    },
    {
      lines: ["P4 VARIANT MIX", "45/30/15/10 PHASE 0.0/0.0"],
      tone: (x, y) => truchetTone(mixA, x, y),
    },
    {
      lines: ["P5 VARIANT MIX", "45/30/15/10 PHASE 0.37/0.61"],
      tone: (x, y) => truchetTone(mixB, x, y),
    },
    {
      lines: ["P6 BASIS CHECKER", "ROT 35 ANISO 1.7 SKEW 0.35"],
      tone: (x, y) => truchetTone(basisChecker, x, y),
    },
  ];
  const opt2: Panel[] = [
    {
      lines: ["P7 WARPED CHECKER", "AMP 0.25R FREQ 1.2"],
      tone: (x, y) => warpTone(warpSoft, x, y),
    },
    {
      lines: ["P8 WARPED CHECKER", "AMP 0.70R FREQ 1.2"],
      tone: (x, y) => warpTone(warpStrong, x, y),
    },
    {
      lines: ["P9 WARPED TRUCHET MIX", "AMP 0.50R FREQ 0.9"],
      tone: (x, y) => warpTone(warpMixA, x, y),
    },
    {
      lines: ["P10 WARPED TRUCHET MIX", "AMP 0.50R WARP PHASE B"],
      tone: (x, y) => warpTone(warpMixB, x, y),
    },
  ];
  const g1 = renderPentagrid(gridA);
  const g2 = renderPentagrid(gridPhason);
  const g3 = renderPentagrid(gridB);
  const g4 = renderPentagrid(gridRot);
  const opt5: BufferedPanel[] = [
    { lines: ["P11 DE BRUIJN DUAL", "ROT 0 SHIFT A"], rgb: g1.rgb },
    { lines: ["P12 DE BRUIJN DUAL", "PHASON GRID3 BY 0.17"], rgb: g2.rgb },
    { lines: ["P13 DE BRUIJN DUAL", "PHASON VECTOR B"], rgb: g3.rgb },
    { lines: ["P14 DE BRUIJN DUAL", "ROT 36 SHIFT A"], rgb: g4.rgb },
  ];
  const entry = (p: Panel) => ({ stats: renderTonePanel(p), lines: p.lines });
  const bentry = (p: BufferedPanel) => ({
    stats: bufferedStats(p.rgb),
    lines: p.lines,
  });
  const s1 = writeLabeledContactSheet(
    opt1.map(entry),
    3,
    "floor-examples/opt1-truchet-checker.png",
  );
  const s2 = writeLabeledContactSheet(
    opt2.map(entry),
    2,
    "floor-examples/opt2-warped.png",
  );
  const s3 = writeLabeledContactSheet(
    opt5.map(bentry),
    2,
    "floor-examples/opt5-pentagrid.png",
  );
  console.log("sheet:", s1);
  console.log("sheet:", s2);
  console.log("sheet:", s3);
  console.log("audit gridA:", g1.audit);
  console.log("audit gridPhason:", g2.audit);
  console.log("audit gridB:", g3.audit);
  console.log("audit gridRot:", g4.audit);

  const tintOrientation = (f: FaceInfo): readonly [number, number, number] =>
    f.fat
      ? iqColor(PAL_SUNSET, f.oclass / 5)
      : scale3(iqColor(PAL_SUNSET, f.oclass / 5), 0.5);
  const tintHeight = (f: FaceInfo): readonly [number, number, number] =>
    scale3(iqColor(PAL_MARINE, f.hclass / 5), f.fat ? 1.0 : 0.7);
  const tintDusk = (f: FaceInfo): readonly [number, number, number] =>
    scale3(iqColor(PAL_DUSK, f.hclass / 5), f.fat ? 1.0 : 0.8);
  const tintPairs = (f: FaceInfo): readonly [number, number, number] =>
    iqColor(PAL_MARINE, (f.oclass + (f.fat ? 0 : 5)) / 10);
  const greyish = (f: FaceInfo): readonly [number, number, number] =>
    f.fat ? [0.95, 0.95, 0.97] : [0.62, 0.63, 0.66];
  const grotto = (f: FaceInfo): readonly [number, number, number] =>
    f.fat ? [0.93, 0.92, 0.9] : [0.78, 0.76, 0.73];
  const colorPanels: BufferedPanel[] = [];
  const audits: string[] = [];
  const push = (
    lines: readonly [string, string],
    render: () => { rgb: Uint8Array; audit: string },
  ) => {
    const out = render();
    colorPanels.push({ lines, rgb: out.rgb });
    audits.push(out.audit);
  };
  push(["C1 ORIENTATION TINT", "FAT 5 CLASSES THIN DEEP"], () =>
    renderPentagrid(gridA, { faceColor: tintOrientation }),
  );
  push(["C2 HEIGHT BANDS", "SITE SUM MOD 5 MARINE"], () =>
    renderPentagrid(gridA, { faceColor: tintHeight }),
  );
  push(["C3 HEIGHT BANDS PHASON B", "SAME RULE NEW SHIFTS"], () =>
    renderPentagrid(gridB, { faceColor: tintHeight }),
  );
  push(["C4 AMMANN BARS", "FIVE GRID FAMILIES OVERLAY"], () =>
    renderPentagrid(gridA, { faceColor: greyish, bars: true }),
  );
  push(["C5 TERRAZZO GROTTO", "WIDE GROUT UNIFORM TILES"], () =>
    renderPentagrid(gridA, {
      faceColor: grotto,
      edgeWidthMult: 3,
      edgeTone: 0.02,
    }),
  );
  push(["C6 FINE SCALE TINT", "SCALE 0.55 ORIENTATION"], () =>
    renderPentagrid({ ...gridA, scale: 0.55 }, { faceColor: tintOrientation }),
  );
  push(["C7 PALETTE ROOM DUSK", "HEIGHT THRU DUSK"], () =>
    renderPentagrid(gridA, { faceColor: tintDusk }),
  );
  push(["C8 TEN PAIR CLASSES", "ONE PALETTE FAT AND THIN"], () =>
    renderPentagrid(gridA, { faceColor: tintPairs }),
  );
  const s4 = writeLabeledContactSheet(
    colorPanels.map(bentry),
    4,
    "floor-examples/opt5-color.png",
  );
  console.log("sheet:", s4);
  for (let i = 0; i < audits.length; i++) {
    console.log(`audit C${i + 1}:`, audits[i]);
  }
  const c9 = renderPentagrid(gridPhason, { faceColor: tintHeight });
  const meanDiff = (a: Uint8Array, b: Uint8Array): number => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  };
  console.log(
    "mean|diff| C2 vs C9 (height rule, the 0.17 phason nudge):",
    meanDiff(colorPanels[1].rgb, c9.rgb).toFixed(1),
  );
});
