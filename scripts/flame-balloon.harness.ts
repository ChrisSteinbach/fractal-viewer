/**
 * Balloon-echo histogram weight sheet (fr-d8ro).
 *
 * The Points renderer's 0.5 dim constant is an additive-sprite exposure
 * choice, not a histogram policy: log-density makes the same numeric weight
 * a different picture. This sheet renders three structurally different
 * shipped systems through the production CPU flame accumulator at weight
 * 0.25 / 0.5 / 1.0 beside the no-echo control. Every column reuses the same
 * seed, framing, enclosing ball, palette and tone map. The console table
 * reports visible echo hit mass, mean luminance on source support and on
 * echo-only support, their ratio, and near-white pixels.
 *
 * VERDICT (2026-08-24): weight 1.0. Echo-only/source mean-luminance balance
 * at weights 0.25 / 0.5 / 1.0 was 0.85 / 0.95 / 1.04 (tetra),
 * 0.51 / 0.59 / 0.67 (fern), and 0.69 / 0.75 / 0.78 (radiolarian). No panel
 * at any weight had a near-white pixel, and source-support luminance stayed
 * effectively flat. Full weight is both the most legible/balanced result and
 * the honest histogram semantics: every plotted source point contributes one
 * source splat and one echo splat. The Points arm's 0.5 is not copied.
 *
 * FADE VERDICT: no radial fade. Applying the Points arm's 4.5→10 raw-radius
 * smoothstep changed NONE of the visible echo deposits at the 0.9× comparison
 * radius. At the persisted 1.6× rest radius, fade-on/off visible mass was
 * 0.987449 / 0.115876 / 1.000000 (tetra / fern / radiolarian): it erased
 * 88.4% of the fern cave wall that still projects into the image. Flame never
 * re-fits bounds after freezing its camera, so those distant-but-visible
 * deposits cannot drag framing; the fade offers no bounds protection and can
 * instead suppress the feature's intended rest pose.
 *
 * Radius is 0.9x and the source auto-frame is widened 1.45x: this is the
 * inflation regime where both copies are intentionally on screen, rather
 * than the 1.6x cave-rest pose whose wall commonly sits beyond a source-fit
 * camera. The ball is computed by the same bbox-center/max-distance recipe
 * Three.js BufferGeometry uses for the displayed Points cloud, then passed
 * through buildBalloonFromBall so rMult and rho margin are production's.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/flame-balloon.harness.ts
 * Writes: scripts/out/flame-balloon-weight.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BALLOON_FAR_CAP_RHO,
  BALLOON_RHO_MARGIN,
  buildBalloonFromBall,
  invertBalloon,
} from "../src/fractal/balloon-de";
import {
  WARMUP_ITERATIONS,
  plotPoint,
  prepareChaosGame,
  stepOrbit,
} from "../src/fractal/chaos-game";
import type { PreparedChaosGame } from "../src/fractal/chaos-game";
import {
  DEFAULT_GAMMA_THRESHOLD,
  accumulateFlame,
  tonemapFlame,
} from "../src/fractal/flame";
import type {
  FlameBalloonEcho,
  FlameHistogram,
  Mat4,
} from "../src/fractal/flame";
import { buildPaletteLUT } from "../src/fractal/palette";
import type { FlamePaletteId } from "../src/fractal/palette";
import {
  curlingFern,
  radiolarian,
  sierpinskiTetrahedron,
} from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import type { Rng } from "../src/fractal/rng";
import type { Transform, Vec3 } from "../src/fractal/types";
import { encodePng } from "./de-preview";

const SIZE = 256;
const ITERATIONS = 2_000_000;
const PROBE_POINTS = 80_000;
const SEED = 0xd8a0;
const R_MULT = 0.9;
const FADE_RADIUS_MULTIPLES = [R_MULT, 1.6] as const;
const FRAME_MARGIN = 1.45;
const WEIGHTS = [0, 0.25, 0.5, 1] as const;

interface Fixture {
  name: string;
  transforms: Transform[];
  palette: FlamePaletteId;
  view: Vec3;
}

const FIXTURES: Fixture[] = [
  {
    name: "tetra",
    transforms: sierpinskiTetrahedron(),
    palette: "spectrum",
    view: [0.7, 0.45, 1],
  },
  {
    name: "fern",
    transforms: curlingFern(),
    palette: "moss",
    view: [0, 0, 1],
  },
  {
    name: "radiolarian",
    transforms: radiolarian(),
    palette: "lagoon",
    view: [0.8, 0.35, 1],
  },
];

const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function normalize(v: Vec3): Vec3 {
  const d = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / d, v[1] / d, v[2] / d];
}

function viewBasis(direction: Vec3): { right: Vec3; up: Vec3 } {
  const forward = normalize(direction);
  const reference: Vec3 = Math.abs(forward[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize(cross(reference, forward));
  return { right, up: cross(forward, right) };
}

function orthoProjection(
  right: Vec3,
  up: Vec3,
  centerU: number,
  centerV: number,
  half: number,
): Mat4 {
  const s = 1 / half;
  return [
    right[0] * s,
    right[1] * s,
    right[2] * s,
    -centerU * s,
    up[0] * s,
    up[1] * s,
    up[2] * s,
    -centerV * s,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
  ];
}

interface Probe {
  balloon: ReturnType<typeof buildBalloonFromBall>;
  projection: Mat4;
  points: Float64Array;
}

/** Probe the plotted set once for both the Points-style ball and framing. */
function probe(prepared: PreparedChaosGame, direction: Vec3, rng: Rng): Probe {
  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const step = stepOrbit(prepared, x, y, z, rng);
    x = step.x;
    y = step.y;
    z = step.z;
  }

  const points = new Float64Array(PROBE_POINTS * 3);
  const { right, up } = viewBasis(direction);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < PROBE_POINTS; i++) {
    const step = stepOrbit(prepared, x, y, z, rng);
    x = step.x;
    y = step.y;
    z = step.z;
    const p = plotPoint(prepared, x, y, z, rng);
    points[i * 3] = p[0];
    points[i * 3 + 1] = p[1];
    points[i * 3 + 2] = p[2];
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    minZ = Math.min(minZ, p[2]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
    maxZ = Math.max(maxZ, p[2]);
    const u = dot(p, right);
    const v = dot(p, up);
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  }

  const center: Vec3 = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  let radius = 0;
  for (let i = 0; i < PROBE_POINTS; i++) {
    radius = Math.max(
      radius,
      Math.hypot(
        points[i * 3] - center[0],
        points[i * 3 + 1] - center[1],
        points[i * 3 + 2] - center[2],
      ),
    );
  }
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;
  const half =
    Math.max(maxU - minU, maxV - minV, Number.EPSILON) * 0.5 * FRAME_MARGIN;
  return {
    balloon: buildBalloonFromBall({ center, radius }, R_MULT),
    projection: orthoProjection(right, up, centerU, centerV, half),
    points,
  };
}

interface FadeStats {
  visible: number;
  fadedVisible: number;
  fadedMassRatio: number;
  maxVisibleRadiusRho: number;
}

/** Compare the Points arm's radial fade with no fade at the only seam a
 * flame can observe: echo points that survive the frozen camera's frustum.
 * Points outside it deposit nothing under either policy and cannot affect
 * any later bounds because Flame never recomputes its already-frozen view. */
function measureFade(probeResult: Probe): FadeStats {
  const { balloon, points, projection } = probeResult;
  // Points uses the raw cloud radius (before the DE-oriented rho margin).
  const rawRadius = balloon.rho / BALLOON_RHO_MARGIN;
  const fadeEnd = BALLOON_FAR_CAP_RHO * rawRadius;
  const fadeStart = 0.45 * fadeEnd;
  const source: Vec3 = [0, 0, 0];
  const inverted: Vec3 = [0, 0, 0];
  let visible = 0;
  let fadedVisible = 0;
  let fadedMass = 0;
  let maxVisibleRadiusRho = 0;
  for (let i = 0; i < points.length; i += 3) {
    source[0] = points[i];
    source[1] = points[i + 1];
    source[2] = points[i + 2];
    const inv = invertBalloon(balloon, source, inverted);
    const cw =
      projection[12] * inv[0] +
      projection[13] * inv[1] +
      projection[14] * inv[2] +
      projection[15];
    if (cw <= 0) continue;
    const ndcX =
      (projection[0] * inv[0] +
        projection[1] * inv[1] +
        projection[2] * inv[2] +
        projection[3]) /
      cw;
    const ndcY =
      (projection[4] * inv[0] +
        projection[5] * inv[1] +
        projection[6] * inv[2] +
        projection[7]) /
      cw;
    if (ndcX < -1 || ndcX >= 1 || ndcY <= -1 || ndcY > 1) continue;
    visible++;
    const rr = Math.hypot(
      inv[0] - balloon.center[0],
      inv[1] - balloon.center[1],
      inv[2] - balloon.center[2],
    );
    maxVisibleRadiusRho = Math.max(maxVisibleRadiusRho, rr / balloon.rho);
    const t = Math.max(
      0,
      Math.min(1, (rr - fadeStart) / (fadeEnd - fadeStart)),
    );
    const fade = 1 - t * t * (3 - 2 * t);
    fadedMass += fade;
    if (fade < 1) fadedVisible++;
  }
  return {
    visible,
    fadedVisible,
    fadedMassRatio: fadedMass / Math.max(visible, 1),
    maxVisibleRadiusRho,
  };
}

function luminance(image: Uint8ClampedArray, bucket: number): number {
  const o = bucket * 4;
  return 0.2126 * image[o] + 0.7152 * image[o + 1] + 0.0722 * image[o + 2];
}

interface Rendered {
  histogram: FlameHistogram;
  image: Uint8ClampedArray;
}

function render(
  fixture: Fixture,
  projection: Mat4,
  echo: FlameBalloonEcho | undefined,
): Rendered {
  const prepared = prepareChaosGame(fixture.transforms);
  const lut = buildPaletteLUT(fixture.palette);
  const histogram = accumulateFlame(
    prepared,
    projection,
    SIZE,
    SIZE,
    ITERATIONS,
    mulberry32(SEED),
    [],
    undefined,
    lut ?? undefined,
    echo,
  );
  return {
    histogram,
    image: tonemapFlame(histogram, {
      exposure: 1,
      gamma: 2.4,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: 1,
    }),
  };
}

function rgb(image: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    out[i * 3] = image[i * 4];
    out[i * 3 + 1] = image[i * 4 + 1];
    out[i * 3 + 2] = image[i * 4 + 2];
  }
  return out;
}

function writeSheet(panels: Uint8Array[]): string {
  const width = SIZE * WEIGHTS.length;
  const height = SIZE * FIXTURES.length;
  const sheet = new Uint8Array(width * height * 3);
  for (let panel = 0; panel < panels.length; panel++) {
    const gx = panel % WEIGHTS.length;
    const gy = Math.floor(panel / WEIGHTS.length);
    const source = panels[panel];
    for (let y = 0; y < SIZE; y++) {
      const src = y * SIZE * 3;
      const dst = ((gy * SIZE + y) * width + gx * SIZE) * 3;
      sheet.set(source.subarray(src, src + SIZE * 3), dst);
    }
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "out", "flame-balloon-weight.png");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(width, height, sheet));
  return path;
}

describe("fr-d8ro flame balloon weight measurement", () => {
  it("renders the production comparison sheet and discloses the balance metrics", () => {
    const panels: Uint8Array[] = [];
    const rows: Record<string, string | number>[] = [];
    const fadeRows: Record<string, string | number>[] = [];
    for (const fixture of FIXTURES) {
      const prepared = prepareChaosGame(fixture.transforms);
      const measured = probe(prepared, fixture.view, mulberry32(SEED ^ 0x51));
      const rawBall = {
        center: measured.balloon.center,
        radius: measured.balloon.rho / BALLOON_RHO_MARGIN,
      };
      for (const radiusMultiple of FADE_RADIUS_MULTIPLES) {
        const fade = measureFade({
          ...measured,
          balloon: buildBalloonFromBall(rawBall, radiusMultiple),
        });
        fadeRows.push({
          system: fixture.name,
          radius: `${radiusMultiple.toFixed(1)}×`,
          visibleEchoSamples: fade.visible,
          samplesFadeTouches: fade.fadedVisible,
          fadeOnVsOffMass: fade.fadedMassRatio.toFixed(6),
          maxVisibleRadiusRho: fade.maxVisibleRadiusRho.toFixed(3),
        });
      }
      const base = render(fixture, measured.projection, undefined);
      const baseMass = base.histogram.hits.reduce((sum, hit) => sum + hit, 0);
      panels.push(rgb(base.image));
      rows.push({
        system: fixture.name,
        weight: "off",
        echoMass: "0%",
        sourceLum: "-",
        echoOnlyLum: "-",
        balance: "-",
        white: "-",
      });

      for (const weight of WEIGHTS.slice(1)) {
        const rendered = render(fixture, measured.projection, {
          balloon: measured.balloon,
          tint: [0, 0, 0],
          tintStrength: 0,
          weight,
        });
        panels.push(rgb(rendered.image));
        let echoMass = 0;
        let sourceLum = 0;
        let sourceCount = 0;
        let echoOnlyLum = 0;
        let echoOnlyCount = 0;
        let white = 0;
        for (let i = 0; i < base.histogram.hits.length; i++) {
          const sourceHit = base.histogram.hits[i];
          const echoHit = rendered.histogram.hits[i] - sourceHit;
          echoMass += echoHit;
          const lum = luminance(rendered.image, i);
          if (sourceHit > 0) {
            sourceLum += lum;
            sourceCount++;
          } else if (echoHit > 0) {
            echoOnlyLum += lum;
            echoOnlyCount++;
          }
          const o = i * 4;
          if (
            rendered.image[o] >= 250 &&
            rendered.image[o + 1] >= 250 &&
            rendered.image[o + 2] >= 250
          ) {
            white++;
          }
        }
        const meanSource = sourceLum / Math.max(sourceCount, 1);
        const meanEcho = echoOnlyLum / Math.max(echoOnlyCount, 1);
        rows.push({
          system: fixture.name,
          weight,
          echoMass: `${((echoMass / baseMass) * 100).toFixed(1)}%`,
          sourceLum: meanSource.toFixed(1),
          echoOnlyLum: meanEcho.toFixed(1),
          balance: (meanEcho / Math.max(meanSource, 1e-9)).toFixed(2),
          white: `${((white / (SIZE * SIZE)) * 100).toFixed(2)}%`,
        });
      }
    }
    console.table(rows);
    console.table(fadeRows);
    const path = writeSheet(panels);
    console.info(`wrote ${path}`);
    expect(panels).toHaveLength(FIXTURES.length * WEIGHTS.length);
  });
});
