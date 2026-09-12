/**
 * Shared CPU instrument for the Surface transmission study.
 *
 * `pixel` is the historical research prototype: both event acceptance and
 * clearance scale with the preview pixel tolerance. `world` is the candidate
 * sampled appearance rule. It normalises every optical length by the fixture's
 * full raw scene ball R, accepts a run at DE <= enterFraction*R, and does not
 * re-arm until a fixed ray grid observes DE > exitFraction*R. This is neither
 * signed membership nor an exact material volume. A gap narrower than the
 * grid can be missed, so nearby runs can be falsely merged; a noisy estimator
 * can still split runs after the hysteretic clearance is observed.
 *
 * Every preview trace goes through de-preview.ts. World-mode work chunks only
 * yield and resume the saved ray parameter and clearance state; they do not
 * define events or attenuation. Termination is an exact marching-ball cap, an
 * opaque event, a residual contribution at or below the named tolerance, or an
 * explicitly unresolved layer/chunk budget.
 */
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
  sixteenCellFlake,
  tesseract,
} from "../src/fractal/presets";
import {
  finishShadeTs,
  resolveSurfaceFinish,
} from "../src/fractal/surface-finish";
import type { Transform, Vec4 } from "../src/fractal/types";
import { PREVIEW_EXHAUSTED, PREVIEW_MISS, renderPreview } from "./de-preview";
import type { PanelStats, PreviewScene, Vec3 } from "./de-preview";
import { CLEARANCE_BAND_CONTRACT } from "./transmission-gpu-contract";

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

export interface Fixture {
  name: string;
  scene: PreviewScene;
  color: (p: Vec3) => Vec3;
  /** Optional event attribution used only for the independent opaque control. */
  opaque?: (p: Vec3) => boolean;
}

export interface FixturePoseOverrides {
  angle: number;
  w0: number;
  eyeOffset: Vec3;
  zoom: number;
}

export interface WorldBandSettings {
  /** Event-entry clearance in units of the full raw scene ball R. */
  enterFraction: number;
  /** Clearance needed to re-arm, in units of R; must exceed enterFraction. */
  exitFraction: number;
  /** Fixed clearance scan spacing along the ray, in units of R. */
  scanFraction: number;
  /** Fractional offset of the ball-entry scan grid in [0, 1). */
  scanPhase: number;
  /** Fixed six-tap optical normal radius, in units of R. */
  opticalNormalFraction: number;
  /** Stop once surviving linear contribution is <= this bound. Default 0. */
  residualTolerance: number;
  /** Per-renderPreview scheduling slice. It cannot alter event semantics. */
  chunkSteps: number;
  /** Explicit guard for a ray that never completes across scheduling chunks. */
  maxChunks: number;
}

export interface TransmissionOptions {
  strategy?: "pixel" | "world";
  worldBand?: Partial<WorldBandSettings>;
  /** The historical virtual-slab image warp is computed by default. */
  warp?: boolean;
  /** Linear radiance beyond the clipped optical domain (sky/floor control). */
  terminalRadiance?: (origin: Vec3, rd: Vec3, py: number, size: number) => Vec3;
}

export interface TransmissionTermination {
  sphereCap: number;
  opaque: number;
  residual: number;
  noIntersection: number;
  unresolved: number;
}

export interface TransmissionWork {
  primary: number;
  clearance: number;
  laterTrace: number;
  attribution: number;
  normal: number;
  opticalNormal: number;
  warp: number;
  worstRay: number;
  perCoveredPixel: number;
}

export interface TransmissionPanel {
  stats: PanelStats;
  linearFade: PanelStats;
  warped: PanelStats;
  warpCalls: number;
  warpFallbacks: number;
  /** Legacy total: all primary/layer march, display-normal and optical-normal calls. */
  calls: number;
  /** Legacy clearance subset. */
  scanCalls: number;
  unresolved: number;
  multiHit: number;
  maxLayers: number;
  strategy: "pixel" | "world";
  worldBand?: WorldBandSettings;
  work: TransmissionWork;
  termination: TransmissionTermination;
  layerHits: number[];
  layerMeanThroughput: number[];
  eventCounts: Uint16Array;
  finalThroughput: Float64Array;
  chunks: number;
}

interface RayState {
  origin: Vec3;
  rd: Vec3;
  /** Analytic sphere entry anchoring the one world-space sample lattice. */
  entry: number;
  /** Next fixed-grid sample, retained across hits and scheduling chunks. */
  sampleIndex: number;
  /** Fixed count covering the half-open clipped ball, excluding its exit. */
  sampleLimit: number;
  lastSamplePoint: Vec3;
  lastSampleT: number;
  t: number;
  end: number;
  active: boolean;
  eventDone: boolean;
  clearing: boolean;
  layers: number;
  weight: number;
  /** Throughput after optical events, before terminal radiance is consumed. */
  eventThroughput: number;
  color: Vec3;
  unresolved: boolean;
  first?: { p: Vec3; rd: Vec3; t: number; local: Vec3; tau: number };
  secondT: number;
  work: number;
  termination?: keyof TransmissionTermination;
}

export const WORLD_BAND_DEFAULTS: Readonly<WorldBandSettings> = Object.freeze({
  enterFraction: CLEARANCE_BAND_CONTRACT.enterRadiusFraction,
  exitFraction: CLEARANCE_BAND_CONTRACT.leaveRadiusFraction,
  scanFraction: CLEARANCE_BAND_CONTRACT.sampleRadiusFraction,
  scanPhase: 0,
  opticalNormalFraction: 0.03,
  residualTolerance: 0,
  chunkSteps: 1200,
  maxChunks: 4096,
});

/** The infinite gradient has no image texture; every comparison shares it. */
function background(py: number, size: number): Vec3 {
  const t = (py + 0.5) / size;
  const top = linear(SKY);
  const bottom = linear(BOTTOM);
  return top.map((v, i) => v + (bottom[i] - v) * t) as Vec3;
}

function validateWorldBand(settings: WorldBandSettings): void {
  if (
    !(settings.enterFraction > 0) ||
    !(settings.exitFraction > settings.enterFraction) ||
    !(settings.scanFraction > 0) ||
    !(settings.scanPhase >= 0 && settings.scanPhase < 1) ||
    !(settings.opticalNormalFraction > 0) ||
    !(settings.residualTolerance >= 0 && settings.residualTolerance < 1) ||
    !Number.isInteger(settings.chunkSteps) ||
    settings.chunkSteps < 1 ||
    !Number.isInteger(settings.maxChunks) ||
    settings.maxChunks < 1
  ) {
    throw new Error("Invalid world transmission band settings");
  }
}

/**
 * Preserve the historical positional signature. The final options argument is
 * additive: omitting it takes the old pixel-tolerance prototype exactly.
 */
export function renderTransmission(
  fixture: Fixture,
  transmit: number,
  layers: boolean,
  size: number,
  maxLayers = 32,
  scanFraction = 0.5,
  maxSteps = 1200,
  options: TransmissionOptions = {},
): TransmissionPanel {
  const strategy = options.strategy ?? "pixel";
  const worldBand: WorldBandSettings = {
    ...WORLD_BAND_DEFAULTS,
    chunkSteps: maxSteps,
    ...options.worldBand,
  };
  if (strategy === "world") validateWorldBand(worldBand);
  const states = new Map<string, RayState>();
  const pixels: RayState[] = [];
  let current: RayState;
  let totalSteps = 0;
  let totalEvals = 0;
  let primaryHits = 0;
  let totalMs = 0;
  let panel: PanelStats | undefined;
  let chunks = 0;
  let legacyScanCalls = 0;
  const work: TransmissionWork = {
    primary: 0,
    clearance: 0,
    laterTrace: 0,
    attribution: 0,
    normal: 0,
    opticalNormal: 0,
    warp: 0,
    worstRay: 0,
    perCoveredPixel: 0,
  };
  const termination: TransmissionTermination = {
    sphereCap: 0,
    opaque: 0,
    residual: 0,
    noIntersection: 0,
    unresolved: 0,
  };
  const layerHits: number[] = [];
  const layerThroughputSum: number[] = [];
  const opticalNormalAt = (p: Vec3, h: number): Vec3 => {
    const values: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
      const a = [...p] as Vec3;
      const b = [...p] as Vec3;
      a[axis] += h;
      b[axis] -= h;
      values.push(fixture.scene.de(a) - fixture.scene.de(b));
      work.opticalNormal += 2;
      current.work += 2;
    }
    return norm(values as Vec3);
  };
  const countedNormalDe = (p: Vec3) => {
    work.normal++;
    current.work++;
    return fixture.scene.de(p);
  };
  const center = fixture.scene.boundingCenter ?? fixture.scene.target ?? BLACK;
  const R = fixture.scene.boundingRadius;
  const target = fixture.scene.target ?? BLACK;
  const off = fixture.scene.eyeOffset ?? [1.55, 1.1, 1.8];
  const eye =
    fixture.scene.eye ?? (target.map((v, i) => v + off[i] * R) as Vec3);
  const terminal = (rd: Vec3, py: number): Vec3 =>
    options.terminalRadiance?.(eye, rd, py, size) ?? background(py, size);
  const encodeLinear = (color: Vec3): Vec3 =>
    color.map((value) => Math.max(0, value) ** (1 / 2.2)) as Vec3;
  const passes = layers ? maxLayers : 1;

  const markTermination = (
    state: RayState,
    reason: keyof TransmissionTermination,
  ) => {
    if (state.termination) return;
    state.termination = reason;
    termination[reason]++;
  };

  for (let layer = 0; layer < passes; layer++) {
    for (const state of states.values()) {
      if (!state.active) continue;
      state.eventDone = false;
      state.clearing = layer > 0;
    }
    let layerChunks = 0;
    do {
      panel = renderPreview(
        {
          ...fixture.scene,
          de: countedNormalDe,
          maxSteps: strategy === "world" ? worldBand.chunkSteps : maxSteps,
          minimumStepFraction: 0,
          fog: false,
          shadow: false,
          ao: false,
          background: { top: linear(SKY), bottom: linear(BOTTOM) },
          marchInterval(origin, rd, pixel) {
            const key = `${pixel.px},${pixel.py}`;
            current = states.get(key)!;
            if (!current) {
              const o = origin.map((v, i) => v - center[i]) as Vec3;
              const b = dot(o, rd);
              const disc = b * b - dot(o, o) + R * R;
              const end = disc >= 0 ? -b + Math.sqrt(disc) : -1;
              const entry = disc >= 0 ? Math.max(0, -b - Math.sqrt(disc)) : 0;
              const firstSample =
                entry + worldBand.scanPhase * worldBand.scanFraction * R;
              const sampleLimit =
                end > firstSample
                  ? Math.ceil(
                      (end - firstSample) / (worldBand.scanFraction * R),
                    )
                  : 0;
              current = {
                origin,
                rd,
                entry,
                sampleIndex: 0,
                sampleLimit,
                lastSamplePoint: origin,
                lastSampleT: entry,
                t:
                  strategy === "world"
                    ? Math.min(
                        end,
                        entry +
                          worldBand.scanPhase * worldBand.scanFraction * R,
                      )
                    : entry,
                end,
                active: end >= 0,
                eventDone: false,
                clearing: false,
                layers: 0,
                weight: 1,
                eventThroughput: 1,
                color: [0, 0, 0],
                unresolved: false,
                secondT: Infinity,
                work: 0,
              };
              if (end < 0) markTermination(current, "noIntersection");
              states.set(key, current);
            }
            if (!current.active || current.eventDone) return null;
            if (
              strategy === "world" &&
              current.sampleIndex >= current.sampleLimit
            )
              return null;
            return [
              current.t,
              strategy === "world"
                ? current.end + worldBand.scanFraction * R
                : current.end,
            ];
          },
          march(p, epsilon) {
            if (
              strategy === "world" &&
              current.sampleIndex >= current.sampleLimit
            ) {
              return {
                d: 1e20,
                stride: (2 * R) / fixture.scene.stepScale,
              };
            }
            let category: "primary" | "clearance" | "laterTrace";
            if (layer === 0) category = "primary";
            else if (current.clearing) category = "clearance";
            else category = "laterTrace";
            work[category]++;
            current.work++;
            const sampleIndex = current.sampleIndex;
            const sampleT =
              current.entry +
              (worldBand.scanPhase + sampleIndex) * worldBand.scanFraction * R;
            const samplePoint: Vec3 =
              strategy === "world"
                ? [
                    current.origin[0] + current.rd[0] * sampleT,
                    current.origin[1] + current.rd[1] * sampleT,
                    current.origin[2] + current.rd[2] * sampleT,
                  ]
                : p;
            current.lastSamplePoint = samplePoint;
            current.lastSampleT = strategy === "world" ? sampleT : current.t;
            const d = fixture.scene.de(samplePoint);
            if (!Number.isFinite(d))
              throw new Error("Nonfinite transmission DE");
            if (strategy === "world") {
              // One globally anchored lattice supplies every event and
              // clearance sample. Advance the integer before returning so a
              // hit and a scheduling yield both resume at the NEXT sample.
              current.sampleIndex++;
              const fixedStride =
                (worldBand.scanFraction * R) / fixture.scene.stepScale;
              if (current.clearing) {
                if (d <= worldBand.exitFraction * R) {
                  return {
                    d: 1e20,
                    stride: fixedStride,
                  };
                }
                current.clearing = false;
              }
              // Force the shared marcher to accept/reject against the fixed
              // optical band, independently of its display epsilon.
              return d <= worldBand.enterFraction * R
                ? { d: 0, stride: fixedStride }
                : { d: 1e20, stride: fixedStride };
            }
            if (current.clearing) {
              if (d <= 1.5 * epsilon) {
                legacyScanCalls++;
                return {
                  d: 1e20,
                  stride: (epsilon * scanFraction) / fixture.scene.stepScale,
                };
              }
              current.clearing = false;
            }
            return { d, stride: d };
          },
          shadeLinear(hit) {
            const eventPoint =
              strategy === "world" ? current.lastSamplePoint : hit.p;
            const eventT = strategy === "world" ? current.lastSampleT : hit.t;
            const terminalLinear = terminal(hit.rd, hit.py);
            const terminalEncoded = encodeLinear(terminalLinear);
            const local = finishShadeTs(
              fixture.color(eventPoint),
              hit.n,
              hit.rd,
              1,
              1,
              terminalEncoded,
              FINISH,
              {
                lightDir: hit.light,
                ambient: 0.25,
                envStrength: 0,
                bgTop: SKY,
                bgBottom: BOTTOM,
              },
            );
            let opticalNormal = hit.n;
            if (strategy === "world") {
              opticalNormal = opticalNormalAt(
                eventPoint,
                worldBand.opticalNormalFraction * R,
              );
              if (dot(opticalNormal, hit.rd) > 0)
                opticalNormal = opticalNormal.map((v) => -v) as Vec3;
            }
            const f =
              0.04 +
              0.96 *
                (1 - Math.max(0, Math.min(1, -dot(opticalNormal, hit.rd)))) **
                  5;
            work.attribution++;
            current.work++;
            const opaque = fixture.opaque?.(eventPoint) ?? false;
            const tau = opaque ? 0 : transmit * (1 - f);
            current.layers++;
            current.eventDone = true;
            current.t =
              strategy === "world"
                ? Math.min(
                    current.end,
                    current.entry +
                      (worldBand.scanPhase + current.sampleIndex) *
                        worldBand.scanFraction *
                        R,
                  )
                : hit.t;
            layerHits[layer] = (layerHits[layer] ?? 0) + 1;
            layerThroughputSum[layer] =
              (layerThroughputSum[layer] ?? 0) + current.weight;
            if (current.layers === 2) current.secondT = eventT;
            const lit = linear(local);
            if (current.layers === 1)
              current.first = {
                p: eventPoint,
                rd: hit.rd,
                t: eventT,
                local: lit.map((v) => (1 - tau) * v) as Vec3,
                tau,
              };
            if (layers) {
              for (let c = 0; c < 3; c++)
                current.color[c] += current.weight * (1 - tau) * lit[c];
              current.weight *= tau;
              current.eventThroughput *= tau;
              if (tau === 0) {
                current.active = false;
                markTermination(current, "opaque");
              } else if (current.weight <= worldBand.residualTolerance) {
                current.active = false;
                markTermination(current, "residual");
              }
            } else {
              // The ACTUAL shipped composition, including gamma-space mix.
              current.color = linear(
                local.map(
                  (v, c) => v * (1 - tau) + terminalEncoded[c] * tau,
                ) as Vec3,
              );
              current.active = false;
              current.weight = 0;
              markTermination(current, tau === 0 ? "opaque" : "residual");
            }
            return current.color;
          },
          rayLinear(ray) {
            pixels[ray.py * size + ray.px] = current;
            if (
              current.active &&
              !current.eventDone &&
              ray.status === PREVIEW_EXHAUSTED
            ) {
              if (strategy === "world") {
                current.t = Math.min(
                  current.end,
                  current.entry +
                    (worldBand.scanPhase + current.sampleIndex) *
                      worldBand.scanFraction *
                      R,
                );
              } else {
                current.unresolved = true;
                current.active = false;
                markTermination(current, "unresolved");
              }
            } else if (
              current.active &&
              !current.eventDone &&
              ray.status === PREVIEW_MISS
            ) {
              const bg = terminal(ray.rd, ray.py);
              for (let c = 0; c < 3; c++)
                current.color[c] += current.weight * bg[c];
              current.weight = 0;
              current.active = false;
              markTermination(current, "sphereCap");
            } else if (layer === 0 && current.end < 0) {
              current.color = terminal(ray.rd, ray.py);
              current.weight = 0;
            }
            return current.color;
          },
        },
        size,
      );
      chunks++;
      layerChunks++;
      if (layer === 0) primaryHits += panel.hits;
      totalSteps += panel.steps;
      totalEvals += panel.evals;
      totalMs += panel.ms;
      if (strategy === "pixel") break;
      if (layerChunks >= worldBand.maxChunks) {
        for (const state of states.values()) {
          if (state.active && !state.eventDone) {
            state.unresolved = true;
            state.active = false;
            markTermination(state, "unresolved");
          }
        }
        break;
      }
    } while (
      [...states.values()].some((state) => state.active && !state.eventDone)
    );
    if (![...states.values()].some((state) => state.active)) break;
  }

  for (const state of states.values()) {
    if (state.active) {
      state.unresolved = true;
      state.active = false;
      markTermination(state, "unresolved");
    }
    work.worstRay = Math.max(work.worstRay, state.work);
  }
  const rows = [...states.values()];
  const unresolved = rows.filter((state) => state.unresolved).length;
  const stats: PanelStats = {
    ...panel!,
    hits: primaryHits,
    exhausted: unresolved,
    steps: totalSteps,
    evals: totalEvals,
    ms: totalMs,
  };
  const callsBeforeWarp =
    work.primary +
    work.clearance +
    work.laterTrace +
    work.normal +
    work.opticalNormal;
  work.perCoveredPixel = primaryHits > 0 ? callsBeforeWarp / primaryHits : 0;

  // Same first hit and weights as the current finish, blended in linear
  // light. This isolates rear geometry from a colour-space-only change.
  const linearFadeRgb = stats.rgb.slice();
  if (!layers)
    for (let i = 0; i < pixels.length; i++) {
      const hit = pixels[i].first;
      if (!hit) continue;
      const bg = terminal(hit.rd, Math.floor(i / size));
      for (let c = 0; c < 3; c++)
        linearFadeRgb[i * 3 + c] = Math.min(
          255,
          Math.round(255 * (hit.local[c] + hit.tau * bg[c]) ** (1 / 2.2)),
        );
    }

  let warpFallbacks = 0;
  const warpedRgb = stats.rgb.slice();
  const forward = norm(target.map((v, i) => v - eye[i]) as Vec3);
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const zoom = fixture.scene.zoom ?? 0.55;
  const rear = (x: number, y: number, depth: number): Vec3 | null => {
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    const state = pixels[y * size + x];
    if (state.unresolved || state.active || state.secondT < depth) return null;
    if (!state.first) return state.color;
    if (state.first.tau < 1e-8) return null;
    return state.color.map((v, c) =>
      Math.max(0, (v - state.first!.local[c]) / state.first!.tau),
    ) as Vec3;
  };
  if (layers && options.warp !== false)
    for (let i = 0; i < pixels.length; i++) {
      const state = pixels[i];
      const hit = state.first;
      if (!hit || hit.tau < 1e-8 || state.unresolved || state.active) continue;
      const h = R * 0.04;
      let n = norm(
        [0, 1, 2].map((axis) => {
          const a = [...hit.p] as Vec3;
          const b = [...hit.p] as Vec3;
          a[axis] += h;
          b[axis] -= h;
          work.warp += 2;
          state.work += 2;
          return fixture.scene.de(a) - fixture.scene.de(b);
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
      const x = Math.floor(sx);
      const y = Math.floor(sy);
      const fx = sx - x;
      const fy = sy - y;
      const taps = [
        rear(x, y, hit.t),
        rear(x + 1, y, hit.t),
        rear(x, y + 1, hit.t),
        rear(x + 1, y + 1, hit.t),
      ];
      if (taps.some((tap) => tap === null)) {
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
  for (const state of states.values())
    work.worstRay = Math.max(work.worstRay, state.work);
  return {
    stats,
    linearFade: { ...stats, rgb: linearFadeRgb },
    warped: { ...stats, rgb: warpedRgb },
    warpCalls: work.warp,
    warpFallbacks,
    calls: callsBeforeWarp,
    scanCalls: strategy === "pixel" ? legacyScanCalls : work.clearance,
    unresolved,
    multiHit: rows.filter((state) => state.layers > 1).length,
    maxLayers: rows.reduce((most, state) => Math.max(most, state.layers), 0),
    strategy,
    worldBand: strategy === "world" ? worldBand : undefined,
    work,
    termination,
    layerHits,
    layerMeanThroughput: layerHits.map(
      (hits, layer) => layerThroughputSum[layer] / hits,
    ),
    eventCounts: Uint16Array.from(pixels, (state) => state.layers),
    finalThroughput: Float64Array.from(
      pixels,
      (state) => state.eventThroughput,
    ),
    chunks,
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

export function fixtures(
  poseOverrides: Partial<FixturePoseOverrides> = {},
): Fixture[] {
  const sponge = buildSurfaceDE(mengerSponge(), null);
  const escape = buildEscapeDE(mandelboxClassic());
  const escape4 = buildEscapeDE4(
    mandelboxClassic().map((transform) => ({
      ...transform,
      w: { scale: 2, position: 0.12 },
    })),
  );
  const pose4 = (
    name: string,
    transforms: Transform[],
    defaultAngle: number,
    defaultW0: number,
  ): Fixture => {
    const core = buildSurfaceDE4(transforms);
    const R = core.visibleBoundingRadius;
    const angle = poseOverrides.angle ?? defaultAngle;
    const w0 = poseOverrides.w0 ?? defaultW0;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
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
        eyeOffset: poseOverrides.eyeOffset ?? [0.55, 0.35, 2.4],
        zoom: poseOverrides.zoom ?? 0.36,
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
        eyeOffset: poseOverrides.eyeOffset ?? [1.05, 0.65, 2.2],
        zoom: poseOverrides.zoom ?? 0.36,
      },
      color: spatialColor(sponge.visibleBoundingRadius),
    },
    {
      name: "MANDELBOX 3D",
      scene: {
        de: (p) => estimateEscapeDistance(escape, p),
        boundingRadius: escape.boundingRadius,
        stepScale: ESCAPE_STEP_SCALE,
        eyeOffset: poseOverrides.eyeOffset ?? [0.8, 0.5, 2.5],
        zoom: poseOverrides.zoom ?? 0.36,
      },
      color: spatialColor(escape.boundingRadius),
    },
    pose4("PENTATOPE 4D", pentatope(), 0.48, -0.1),
    pose4("TESSERACT 4D", tesseract(), 0.35, 0.2),
    pose4("16-CELL FLAKE 4D", sixteenCellFlake(), 0.43, 0.14),
    {
      name: "MANDELBOX 4D",
      scene: {
        de: (p) => {
          const angle = poseOverrides.angle ?? 0.35;
          const w0 = poseOverrides.w0 ?? 0.3;
          return estimateEscapeDistance4(escape4, [
            Math.cos(angle) * p[0] - Math.sin(angle) * w0,
            p[1],
            p[2],
            Math.sin(angle) * p[0] + Math.cos(angle) * w0,
          ]);
        },
        boundingRadius: escape4.boundingRadius,
        stepScale: ESCAPE_STEP_SCALE,
        eyeOffset: poseOverrides.eyeOffset ?? [0.8, 0.5, 2.5],
        zoom: poseOverrides.zoom ?? 0.36,
      },
      color: spatialColor(escape4.boundingRadius),
    },
  ];
}

export function pair(rear: boolean): Fixture {
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

export function delta(a: PanelStats, b: PanelStats): number {
  if (a.rgb.length !== b.rgb.length)
    throw new Error("Transmission delta requires matched raster sizes");
  return (
    a.rgb.reduce((sum, value, i) => sum + Math.abs(value - b.rgb[i]), 0) /
    a.rgb.length
  );
}
