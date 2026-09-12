/**
 * Surface transmission research, NOT a production transport implementation.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *   scripts/finish-transmission.harness.ts
 * Optional TRANSMISSION_SIZE (default 192) controls the comparison panels.
 *
 * Every layer uses de-preview.ts's existing renderer. Its march hook advances
 * through the previous hit's acceptance band in small sampled steps, then
 * re-arms ordinary sphere tracing after finding clearance. This deliberately
 * makes NO claim that a small/negative DE is membership or interior distance.
 * It composites one sheet per separated run of accepted samples. Gaps smaller
 * than the scan spacing can be missed; adjacent runs merge at the clearance
 * threshold. Both the scan spacing and the layer budget are measured below.
 *
 * Straight-through alpha composition and an image-space slab warp are the
 * subjects. No traced refraction, interior absorption, multiple scattering,
 * transparent shadows or GPU timing claim.
 * Primary and continuation exhaustion retain a dark unresolved remainder,
 * never a fabricated background miss. All DE calls, including normals, count.
 * Full analysis and the source audit: docs/surface-transmission.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  buildSurfaceDE,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4Refined,
} from "../src/fractal/surface-de-4d";
import {
  buildEscapeDE,
  ESCAPE_STEP_SCALE,
  estimateEscapeDistance,
} from "../src/fractal/escape-de";
import {
  buildEscapeDE4,
  estimateEscapeDistance4,
} from "../src/fractal/escape-de-4d";
import {
  mandelboxClassic,
  mengerSponge,
  pentatope,
  tesseract,
} from "../src/fractal/presets";
import {
  finishShadeTs,
  resolveSurfaceFinish,
} from "../src/fractal/surface-finish";
import type { Transform, Vec4 } from "../src/fractal/types";
import {
  PREVIEW_EXHAUSTED,
  PREVIEW_MISS,
  encodePng,
  renderPreview,
  writeLabeledContactSheet,
} from "./de-preview";
import type { PanelStats, PreviewScene, Vec3 } from "./de-preview";

const SIZE = Number(process.env.TRANSMISSION_SIZE ?? 192);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a);
  return length > 1e-15 ? (a.map((v) => v / length) as Vec3) : [0, 0, 1];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const linear = (c: Vec3): Vec3 => c.map((v) => Math.max(0, v) ** 2.2) as Vec3;
const BLACK: Vec3 = [0, 0, 0];
const SKY: Vec3 = [0.1, 0.14, 0.2];
const BOTTOM: Vec3 = [0.025, 0.035, 0.055];
const FINISH = resolveSurfaceFinish({
  specular: 1,
  shininess: 128,
  reflect: 0.5,
});

interface Fixture {
  name: string;
  scene: PreviewScene;
  color: (p: Vec3) => Vec3;
  /** Optional opaque rear material for the independent occlusion control. */
  opaque?: (p: Vec3) => boolean;
}

interface RayState {
  t: number;
  end: number;
  active: boolean;
  layers: number;
  weight: number;
  color: Vec3;
  unresolved: boolean;
  first?: { p: Vec3; rd: Vec3; t: number; local: Vec3; tau: number };
  secondT: number;
}

interface TransmissionPanel {
  stats: PanelStats;
  linearFade: PanelStats;
  warped: PanelStats;
  warpCalls: number;
  warpFallbacks: number;
  calls: number;
  scanCalls: number;
  unresolved: number;
  multiHit: number;
  maxLayers: number;
}

/** The infinite gradient has no image texture; every comparison shares it. */
function background(py: number, size: number): Vec3 {
  const t = (py + 0.5) / size;
  const top = linear(SKY);
  const bottom = linear(BOTTOM);
  return top.map((v, i) => v + (bottom[i] - v) * t) as Vec3;
}

function renderTransmission(
  fixture: Fixture,
  transmit: number,
  layers: boolean,
  size: number,
  maxLayers = 32,
  scanFraction = 0.5,
  maxSteps = 1200,
): TransmissionPanel {
  const states = new Map<string, RayState>();
  const pixels: RayState[] = [];
  let current: RayState;
  let clearing = false;
  let calls = 0;
  let scanCalls = 0;
  let totalSteps = 0;
  let totalEvals = 0;
  let primaryHits = 0;
  let totalMs = 0;
  let panel: PanelStats | undefined;
  const de = (p: Vec3) => {
    calls++;
    return fixture.scene.de(p);
  };
  const center = fixture.scene.boundingCenter ?? fixture.scene.target ?? BLACK;
  const R = fixture.scene.boundingRadius;
  const passes = layers ? maxLayers : 1;

  for (let layer = 0; layer < passes; layer++) {
    panel = renderPreview(
      {
        ...fixture.scene,
        de,
        maxSteps,
        minimumStepFraction: 0,
        fog: false,
        shadow: false,
        ao: false,
        background: { top: linear(SKY), bottom: linear(BOTTOM) },
        marchInterval(origin, rd) {
          // Exactly the same camera rays are used for every layer. A key on
          // their components avoids depending on the renderer's visit order.
          const key = rd.join(",");
          if (layer === 0) {
            const o = origin.map((v, i) => v - center[i]) as Vec3;
            const b = dot(o, rd);
            const disc = b * b - dot(o, o) + R * R;
            const end = disc >= 0 ? -b + Math.sqrt(disc) : -1;
            current = {
              t: disc >= 0 ? Math.max(0, -b - Math.sqrt(disc)) : 0,
              end,
              active: end >= 0,
              layers: 0,
              weight: 1,
              color: [0, 0, 0],
              unresolved: false,
              secondT: Infinity,
            };
            states.set(key, current);
          } else {
            current = states.get(key)!;
          }
          clearing = layer > 0;
          return current.active ? [current.t, current.end] : null;
        },
        march(p, epsilon) {
          const d = de(p);
          if (!Number.isFinite(d)) throw new Error("Nonfinite transmission DE");
          if (clearing) {
            if (d <= 1.5 * epsilon) {
              scanCalls++;
              // The shared marcher owns the budget and damping. A finite
              // rejected acceptance value with a separate fixed stride keeps
              // scanning; abs(d) is NEVER interpreted as interior clearance.
              return {
                d: 1e20,
                stride: (epsilon * scanFraction) / fixture.scene.stepScale,
              };
            }
            clearing = false;
          }
          return { d, stride: d };
        },
        shadeLinear(hit) {
          const local = finishShadeTs(
            fixture.color(hit.p),
            hit.n,
            hit.rd,
            1,
            1,
            hit.bg,
            FINISH,
            {
              lightDir: hit.light,
              ambient: 0.25,
              envStrength: 0,
              bgTop: SKY,
              bgBottom: BOTTOM,
            },
          );
          const f =
            0.04 +
            0.96 * (1 - Math.max(0, Math.min(1, -dot(hit.n, hit.rd)))) ** 5;
          const tau = fixture.opaque?.(hit.p) ? 0 : transmit * (1 - f);
          current.layers++;
          current.t = hit.t;
          if (current.layers === 2) current.secondT = hit.t;
          const lit = linear(local);
          if (current.layers === 1)
            current.first = {
              p: hit.p,
              rd: hit.rd,
              t: hit.t,
              local: lit.map((v) => (1 - tau) * v) as Vec3,
              tau,
            };
          if (layers) {
            for (let c = 0; c < 3; c++)
              current.color[c] += current.weight * (1 - tau) * lit[c];
            current.weight *= tau;
            if (current.weight === 0) current.active = false;
          } else {
            // The ACTUAL shipped composition, including its gamma-space mix.
            current.color = linear(
              local.map((v, c) => v * (1 - tau) + hit.bg[c] * tau) as Vec3,
            );
            current.active = false;
            current.weight = 0;
          }
          return current.color;
        },
        rayLinear(ray) {
          pixels[ray.py * size + ray.px] = current;
          if (current.active && ray.status === PREVIEW_EXHAUSTED) {
            current.unresolved = true;
            current.active = false;
          } else if (current.active && ray.status === PREVIEW_MISS) {
            const bg = background(ray.py, size);
            for (let c = 0; c < 3; c++)
              current.color[c] += current.weight * bg[c];
            current.weight = 0;
            current.active = false;
          } else if (layer === 0 && current.end < 0) {
            current.color = background(ray.py, size);
            current.weight = 0;
          }
          return current.color;
        },
      },
      size,
    );
    if (layer === 0) primaryHits = panel.hits;
    totalSteps += panel.steps;
    totalEvals += panel.evals;
    totalMs += panel.ms;
    if (![...states.values()].some((s) => s.active)) break;
  }
  const rows = [...states.values()];
  const unresolved = rows.filter((s) => s.unresolved || s.active).length;
  const stats: PanelStats = {
    ...panel!,
    hits: primaryHits,
    exhausted: unresolved,
    steps: totalSteps,
    evals: totalEvals,
    ms: totalMs,
  };
  const layeredCalls = calls;
  // Same first hit and same weights as the current finish, blended in linear
  // light. This isolates revealing rear geometry from changing colour space.
  const linearFadeRgb = stats.rgb.slice();
  if (!layers)
    for (let i = 0; i < pixels.length; i++) {
      const hit = pixels[i].first;
      if (!hit) continue;
      const bg = background(Math.floor(i / size), size);
      for (let c = 0; c < 3; c++)
        linearFadeRgb[i * 3 + c] = Math.min(
          255,
          Math.round(255 * (hit.local[c] + hit.tau * bg[c]) ** (1 / 2.2)),
        );
    }
  let warpFallbacks = 0;
  const warpedRgb = stats.rgb.slice();
  // A separate, intentionally approximate optical treatment: refract into
  // a virtual parallel slab, then exit parallel to the original camera ray.
  // Its lateral offset samples the already rendered rear layers. The front
  // hit and silhouette never move. This is image-space distortion, not a
  // discovered back surface or an actual refracted geometry query.
  const target = fixture.scene.target ?? BLACK;
  const off = fixture.scene.eyeOffset ?? [1.55, 1.1, 1.8];
  const eye =
    fixture.scene.eye ?? (target.map((v, i) => v + off[i] * R) as Vec3);
  const forward = norm(target.map((v, i) => v - eye[i]) as Vec3);
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const zoom = fixture.scene.zoom ?? 0.55;
  const rear = (x: number, y: number, depth: number): Vec3 | null => {
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    const r = pixels[y * size + x];
    if (r.unresolved || r.active || r.secondT < depth) return null;
    if (!r.first) return r.color;
    if (r.first.tau < 1e-8) return null;
    return r.color.map((v, c) =>
      Math.max(0, (v - r.first!.local[c]) / r.first!.tau),
    ) as Vec3;
  };
  if (layers)
    for (let i = 0; i < pixels.length; i++) {
      const r = pixels[i];
      const hit = r.first;
      if (!hit || hit.tau < 1e-8 || r.unresolved || r.active) continue;
      const h = R * 0.04;
      let n = norm(
        [0, 1, 2].map((axis) => {
          const a = [...hit.p] as Vec3,
            b = [...hit.p] as Vec3;
          a[axis] += h;
          b[axis] -= h;
          return de(a) - de(b);
        }) as Vec3,
      );
      if (dot(n, hit.rd) > 0) n = n.map((v) => -v) as Vec3;
      const cosI = Math.max(0, Math.min(1, -dot(n, hit.rd)));
      const eta = 1 / 1.45;
      const cosT = Math.sqrt(1 - eta * eta * (1 - cosI * cosI));
      const refracted = hit.rd.map(
        (v, c) => eta * v + (eta * cosI - cosT) * n[c],
      ) as Vec3;
      const offset = refracted.map(
        (v, c) => R * 0.08 * (v / cosT - hit.rd[c] / Math.max(0.15, cosI)),
      ) as Vec3;
      const depth = hit.t * dot(hit.rd, forward);
      const scale = size / (2 * zoom * depth);
      const sx =
        (i % size) +
        Math.max(
          -size * 0.04,
          Math.min(size * 0.04, dot(offset, right) * scale),
        );
      const sy =
        Math.floor(i / size) -
        Math.max(-size * 0.04, Math.min(size * 0.04, dot(offset, up) * scale));
      const x = Math.floor(sx),
        y = Math.floor(sy),
        fx = sx - x,
        fy = sy - y;
      const taps = [
        rear(x, y, hit.t),
        rear(x + 1, y, hit.t),
        rear(x, y + 1, hit.t),
        rear(x + 1, y + 1, hit.t),
      ];
      if (taps.some((t) => t === null)) {
        warpFallbacks++;
        continue;
      }
      const weights = [
        (1 - fx) * (1 - fy),
        fx * (1 - fy),
        (1 - fx) * fy,
        fx * fy,
      ];
      for (let c = 0; c < 3; c++) {
        const transmitted = taps.reduce(
          (sum, tap, t) => sum + tap![c] * weights[t],
          0,
        );
        const color = hit.local[c] + hit.tau * transmitted;
        warpedRgb[i * 3 + c] = Math.max(
          0,
          Math.min(255, Math.round(255 * color ** (1 / 2.2))),
        );
      }
    }
  return {
    stats,
    linearFade: { ...stats, rgb: linearFadeRgb },
    warped: { ...stats, rgb: warpedRgb },
    warpCalls: calls - layeredCalls,
    warpFallbacks,
    calls: layeredCalls,
    scanCalls,
    unresolved,
    multiHit: rows.filter((s) => s.layers > 1).length,
    maxLayers: rows.reduce((most, s) => Math.max(most, s.layers), 0),
  };
}

function spatialColor(R: number): (p: Vec3) => Vec3 {
  return (p) => {
    const t = Math.max(0, Math.min(1, p[2] / (1.3 * R) + 0.5));
    return [
      0.95 * (1 - t) + 0.12 * t,
      0.26 * (1 - t) + 0.8 * t,
      0.12 * (1 - t) + 0.96 * t,
    ];
  };
}

function fixtures(): Fixture[] {
  const sponge = buildSurfaceDE(mengerSponge(), null);
  const escape = buildEscapeDE(mandelboxClassic());
  const escape4 = buildEscapeDE4(
    mandelboxClassic().map((t) => ({ ...t, w: { scale: 2, position: 0.12 } })),
  );
  const pose4 = (
    name: string,
    transforms: Transform[],
    angle: number,
    w0: number,
  ): Fixture => {
    const core = buildSurfaceDE4(transforms);
    const R = core.visibleBoundingRadius;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    // Inverse XW rotor applied to the displayed 3D slice. Both the off-centre
    // slice and the XW mixing are nonzero, so this cannot be a flat lift.
    const query = (p: Vec3): Vec4 => [
      c * p[0] - s * w0,
      p[1],
      p[2],
      s * p[0] + c * w0,
    ];
    return {
      name,
      scene: {
        de: (p) => estimateDistance4Refined(core, query(p)),
        boundingRadius: R,
        stepScale: 1,
        eyeOffset: [0.55, 0.35, 2.4],
        zoom: 0.36,
      },
      color: spatialColor(R),
    };
  };
  return [
    {
      name: "MENGER 3D",
      scene: {
        de: (p) => estimateDistanceRefined(sponge, p),
        boundingRadius: sponge.visibleBoundingRadius,
        target: sponge.boundCenter,
        stepScale: sponge.stepScale,
        eyeOffset: [1.05, 0.65, 2.2],
        zoom: 0.36,
      },
      color: spatialColor(sponge.visibleBoundingRadius),
    },
    {
      name: "MANDELBOX 3D",
      scene: {
        de: (p) => estimateEscapeDistance(escape, p),
        boundingRadius: escape.boundingRadius,
        stepScale: ESCAPE_STEP_SCALE,
        eyeOffset: [0.8, 0.5, 2.5],
        zoom: 0.36,
      },
      color: spatialColor(escape.boundingRadius),
    },
    pose4("PENTATOPE 4D", pentatope(), 0.48, -0.1),
    pose4("TESSERACT 4D", tesseract(), 0.35, 0.2),
    {
      name: "MANDELBOX 4D",
      scene: {
        de: (p) =>
          estimateEscapeDistance4(escape4, [
            Math.cos(0.35) * p[0] - Math.sin(0.35) * 0.3,
            p[1],
            p[2],
            Math.sin(0.35) * p[0] + Math.cos(0.35) * 0.3,
          ]),
        boundingRadius: escape4.boundingRadius,
        stepScale: ESCAPE_STEP_SCALE,
        eyeOffset: [0.8, 0.5, 2.5],
        zoom: 0.36,
      },
      color: spatialColor(escape4.boundingRadius),
    },
  ];
}

function pair(rear: boolean): Fixture {
  return {
    name: "UNSIGNED SPHERES",
    scene: {
      de: (p) =>
        Math.max(
          0,
          Math.min(
            Math.hypot(p[0], p[1], p[2] - 0.6) - 0.43,
            rear ? Math.hypot(p[0], p[1], p[2] + 0.6) - 0.43 : Infinity,
          ),
        ),
      boundingRadius: 1.4,
      stepScale: 1,
      eye: [0, 0, 4],
      zoom: 0.3,
    },
    color: (p) => (p[2] > 0 ? [0.12, 0.8, 0.96] : [1, 0.18, 0.04]),
    opaque: (p) => p[2] < 0,
  };
}

function delta(a: PanelStats, b: PanelStats): number {
  return (
    a.rgb.reduce((sum, v, i) => sum + Math.abs(v - b.rgb[i]), 0) / a.rgb.length
  );
}

describe("Surface transmission research", () => {
  it("reveals a genuinely hidden opaque object through an unsigned front object", () => {
    const oldWith = renderTransmission(pair(true), 0.9, false, 129);
    const oldWithout = renderTransmission(pair(false), 0.9, false, 129);
    const throughWith = renderTransmission(pair(true), 0.9, true, 129);
    const throughWithout = renderTransmission(pair(false), 0.9, true, 129);
    const at = (64 * 129 + 64) * 3;
    expect([...oldWith.stats.rgb.slice(at, at + 3)]).toEqual([
      ...oldWithout.stats.rgb.slice(at, at + 3),
    ]);
    expect(
      throughWith.stats.rgb[at] - throughWithout.stats.rgb[at],
    ).toBeGreaterThan(80);
    expect(throughWith.unresolved).toBe(0);
    expect(throughWithout.unresolved).toBe(0);
    writeLabeledContactSheet(
      [
        { stats: oldWith.stats, lines: ["CURRENT / REAR ON", "TRANSMIT 0.9"] },
        {
          stats: oldWithout.stats,
          lines: ["CURRENT / REAR OFF", "TRANSMIT 0.9"],
        },
        {
          stats: throughWith.stats,
          lines: ["LAYERS / REAR ON", "TRANSMIT 0.9"],
        },
        {
          stats: throughWithout.stats,
          lines: ["LAYERS / REAR OFF", "TRANSMIT 0.9"],
        },
      ],
      4,
      "transmission-control.png",
    );
  });

  it("reports unresolved continuations instead of painting an untraced background", () => {
    const capped = renderTransmission(pair(true), 1, true, 33, 1);
    expect(capped.unresolved).toBeGreaterThan(0);
    const plateau = pair(false);
    plateau.scene.de = (p) => Math.max(0, p[2] - 0.65);
    plateau.opaque = undefined;
    const exhausted = renderTransmission(plateau, 1, true, 33, 4, 0.5, 2);
    expect(exhausted.unresolved).toBeGreaterThan(0);
  });

  it("renders current and layered finishes on the real 3D and posed 4D estimators", () => {
    const panels: { stats: PanelStats; lines: [string, string] }[] = [];
    const report: object[] = [];
    for (const fixture of fixtures()) {
      const modes = [
        { label: "OPAQUE", t: 0, layers: false },
        { label: "CURRENT 0.35", t: 0.35, layers: false },
        { label: "CURRENT 0.90", t: 0.9, layers: false },
        { label: "LAYERS 0.90", t: 0.9, layers: true },
      ];
      for (const mode of modes) {
        const result = renderTransmission(fixture, mode.t, mode.layers, SIZE);
        const { stats, warped, linearFade, ...counters } = result;
        const row = {
          fixture: fixture.name,
          mode: mode.label,
          size: SIZE,
          hits: stats.hits,
          ms: stats.ms,
          ...counters,
        };
        console.log(JSON.stringify(row));
        report.push(row);
        panels.push({ stats, lines: [fixture.name, mode.label] });
        if (!mode.layers && mode.t === 0.9) {
          panels.push({
            stats: linearFade,
            lines: [fixture.name, "LINEAR FADE 0.90"],
          });
          report.push({
            fixture: fixture.name,
            linearFadeDelta: delta(stats, linearFade),
          });
        }
        if (mode.layers) {
          panels.push({
            stats: warped,
            lines: [fixture.name, "LAYERS + SLAB WARP"],
          });
          report.push({
            fixture: fixture.name,
            warpDelta: delta(stats, warped),
            warpCalls: result.warpCalls,
            warpFallbacks: result.warpFallbacks,
          });
        }
      }
      // A smaller cost/convergence instrument, separately labelled. This
      // checks the scan, not visual approval or the truth of DE membership.
      const coarse = renderTransmission(fixture, 0.9, true, 80, 32, 0.5);
      const fine = renderTransmission(fixture, 0.9, true, 80, 64, 0.25, 2400);
      const short = renderTransmission(fixture, 0.9, true, 80, 8, 0.5);
      const row = {
        fixture: fixture.name,
        convergenceSize: 80,
        halfScanDelta: delta(coarse.stats, fine.stats),
        eightLayerDelta: delta(short.stats, coarse.stats),
        unresolved32: coarse.unresolved,
        unresolved64: fine.unresolved,
        unresolved8: short.unresolved,
      };
      console.log(JSON.stringify(row));
      report.push(row);
      expect(fine.unresolved).toBe(0);
    }
    const path = writeLabeledContactSheet(
      panels,
      6,
      "transmission-comparison.png",
    );
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(
      "scripts/out/transmission-report.json",
      JSON.stringify(report, null, 2),
    );
    // Individual panels are convenient for inspection at native resolution.
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i].stats;
      writeFileSync(
        `scripts/out/transmission-${i}.png`,
        encodePng(p.width, p.height, p.rgb),
      );
    }
    console.log(path);
  });
});
