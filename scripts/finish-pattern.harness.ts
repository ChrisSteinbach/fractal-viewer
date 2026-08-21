/**
 * Pre-wire evidence gate for hybrid surface patterns.
 *
 * Material identity comes from object-attached macrostructure: cylindrical
 * wood, a warped marble plane, and broad strata. Calibrated rings/sheets are
 * bounded secondary detail, footprint-gated into close-ups by crossfading
 * completed ramp outputs. This does not add document fields or shaders.
 *
 * Each selected system produces a labeled, run-specific sheet with
 * none/wood/marble/strata at 1x/4x/16x/64x plus macro-only and world-space
 * controls at 1x/64x. A JSON manifest records constants and machine metrics.
 * Human recognition remains a five-reviewer blinded gate; cards are emitted.
 *
 * Full run:
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/finish-pattern-model.harness.ts scripts/finish-pattern.harness.ts
 * Focused run:
 *   FINISH_PATTERN_SYSTEMS=menger FINISH_PATTERN_SIZE=96 \
 *   FINISH_PATTERN_RUN_ID=dev-menger npx vitest run \
 *     --config scripts/vitest.harness.config.ts scripts/finish-pattern.harness.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  buildSurfaceDE,
  deHasFolds,
  estimateDistance,
  estimateDistanceRefined,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_NONE,
  SURFACE_FOLD_SPHEREFOLD,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import {
  CLASSIC_SURFACE_FINISH,
  finishShadeTs,
} from "../src/fractal/surface-finish";
import type { SurfaceFinishShadeEnv } from "../src/fractal/surface-finish";
import { mengerSponge } from "../src/fractal/presets";
import type { Transform, Vec3 as CoreVec3 } from "../src/fractal/types";
import {
  PREVIEW_BG_BOTTOM,
  PREVIEW_BG_TOP,
  PREVIEW_HIT,
  renderPreview,
  writeLabeledContactSheet,
} from "./de-preview";
import type {
  DistanceEstimator,
  PanelStats,
  PreviewHit,
  Vec3,
} from "./de-preview";
import {
  PATTERN_DEFAULT_SCALE,
  PATTERN_DETAIL_FOOTPRINT_FULL,
  PATTERN_DETAIL_FOOTPRINT_OFF,
  PATTERN_DETAIL_MIX,
  PATTERN_NATIVE_PERIODS,
  PATTERN_NOISE_OCTAVES,
  calibrateNativeCarrier,
  evaluateSurfacePattern,
  normalizeNativeCarrier,
  type NativeCalibration,
  type PatternDetailMode,
  type PatternKind,
  type PatternParams,
} from "./finish-pattern-model";
import { foldMandelboxPair } from "./harness-profiles";

const OUT_ROOT = join(import.meta.dirname, "out");
const DEFAULT_SIZE = 96;
const SIZE = Math.max(
  64,
  Math.round(Number(process.env.FINISH_PATTERN_SIZE) || DEFAULT_SIZE),
);
const PROBE_SIZE = 96;
const ZOOMS = [1, 4, 16, 64] as const;
const MIN_HIT_FRACTION = 0.02;
const EDGE_DENSITY_MIN = 0.08;
const EDGE_DENSITY_MAX = 0.45;
const MID_ENERGY_MIN = 0.25;
const FINE_ENERGY_MAX = 0.6;
const RUNG_VARIANCE_RETENTION_MIN = 0.6;
const END_VARIANCE_RETENTION_MIN = 0.5;

const sanitize = (s: string): string =>
  s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
const autoRunId = `${new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z")}-${process.pid}`;
const RUN_ID = sanitize(process.env.FINISH_PATTERN_RUN_ID ?? autoRunId);
const RUN_DIR_NAME = `finish-pattern-${RUN_ID}`;
const RUN_DIR = join(OUT_ROOT, RUN_DIR_NAME);
mkdirSync(RUN_DIR, { recursive: true });

const ENV_BASE: Omit<SurfaceFinishShadeEnv, "lightDir"> = {
  ambient: 0.25,
  envStrength: 0.35,
  bgTop: PREVIEW_BG_TOP.map((c) => Math.pow(c, 1 / 2.2)) as CoreVec3,
  bgBottom: PREVIEW_BG_BOTTOM.map((c) => Math.pow(c, 1 / 2.2)) as CoreVec3,
};
const BASES: Readonly<Record<PatternKind, Vec3>> = {
  none: [0.72, 0.64, 0.52],
  wood: [0.78, 0.55, 0.3],
  marble: [0.9, 0.88, 0.84],
  strata: [0.72, 0.6, 0.44],
};

interface HitInfo {
  rings: number;
  sheets: number;
  levels: number;
}

function stepSector(
  plane: SurfaceDE["symmetry"]["plane"],
  c: number,
  s: number,
  v: Vec3,
): Vec3 {
  const [x, y, z] = v;
  if (plane === "yz") return [x, c * y + s * z, -s * y + c * z];
  if (plane === "xz") return [c * x - s * z, y, s * x + c * z];
  return [c * x + s * y, -s * x + c * y, z];
}

function sourcePoint(de: SurfaceDE, p: Vec3): Vec3 {
  if (!de.final) return [p[0], p[1], p[2]];
  const f = de.final;
  return [
    f.invM[0] * p[0] + f.invM[1] * p[1] + f.invM[2] * p[2] + f.invT[0],
    f.invM[3] * p[0] + f.invM[4] * p[1] + f.invM[5] * p[2] + f.invT[1],
    f.invM[6] * p[0] + f.invM[7] * p[1] + f.invM[8] * p[2] + f.invT[2],
  ];
}

/** CPU mirror of the shader's greedy rings/sheets carrier chain. */
function hitInfo(de: SurfaceDE, p: Vec3): HitInfo {
  if (de.foldFinal) {
    throw new Error("finish-pattern: a pure-fold final lens is not mirrored");
  }
  const q = sourcePoint(de, p);
  const { order, plane, stepCos, stepSin } = de.symmetry;
  const R = de.boundingRadius;
  const [bcX, bcY, bcZ] = de.boundCenter;
  let rings = 1;
  let sheets = 1;
  let levels = 0;
  let ch = q;
  let chScale = 1;
  let chFloor = 0;
  for (let depth = 0; depth < de.maxDepth; depth++) {
    let lbKey = Infinity;
    let lbR = 0;
    let lbAbsY = 0;
    let lbQ: Vec3 = [0, 0, 0];
    let lbScale = 1;
    let lbFloor = 0;
    const pScale = chScale;
    const pFloor = chFloor;
    let sectorP = ch;
    for (let k = 0; k < order; k++) {
      if (k > 0) sectorP = stepSector(plane, stepCos, stepSin, sectorP);
      for (const map of de.maps) {
        const im = map.invM;
        const it = map.invT;
        const kind = map.foldKind;
        const branchCount =
          kind === SURFACE_FOLD_NONE
            ? 1
            : kind === SURFACE_FOLD_BOXFOLD
              ? 27
              : kind === SURFACE_FOLD_SPHEREFOLD
                ? 3
                : 81;
        const absW = map.foldSigma / map.sigmaMin;
        const fr = map.foldRadii;
        const wall2 = 2 * fr.wall;
        let u: Vec3 = [0, 0, 0];
        let ru = 0;
        let pre0: Vec3 = [0, 0, 0];
        let pre1: Vec3 = [0, 0, 0];
        let pre2: Vec3 = [0, 0, 0];
        let dUp: Vec3 = [0, 0, 0];
        let dDn: Vec3 = [0, 0, 0];
        let v: Vec3 = [0, 0, 0];
        let sfSigma = 1;
        let sfRd = 0;
        const boxSetup = (w: Vec3): void => {
          pre0 = w;
          pre1 = [wall2 - w[0], wall2 - w[1], wall2 - w[2]];
          pre2 = [-wall2 - w[0], -wall2 - w[1], -wall2 - w[2]];
          dUp = [
            Math.max(w[0] - fr.wall, 0),
            Math.max(w[1] - fr.wall, 0),
            Math.max(w[2] - fr.wall, 0),
          ];
          dDn = [
            Math.max(-fr.wall - w[0], 0),
            Math.max(-fr.wall - w[1], 0),
            Math.max(-fr.wall - w[2], 0),
          ];
        };
        if (kind !== SURFACE_FOLD_NONE) {
          u = [
            sectorP[0] * map.foldInvW,
            sectorP[1] * map.foldInvW,
            sectorP[2] * map.foldInvW,
          ];
          if (kind === SURFACE_FOLD_BOXFOLD) boxSetup(u);
          else ru = Math.hypot(...u);
        }
        for (let b = 0; b < branchCount; b++) {
          let candidate: Vec3;
          let branchSigma: number;
          let branchRd = 0;
          if (kind === SURFACE_FOLD_NONE) {
            candidate = sectorP;
            branchSigma = map.sigmaMin;
          } else {
            if (
              kind === SURFACE_FOLD_SPHEREFOLD ||
              (kind === SURFACE_FOLD_MANDELBOX && b % 27 === 0)
            ) {
              const piece = kind === SURFACE_FOLD_SPHEREFOLD ? b : (b / 27) | 0;
              if (piece === 0) {
                v = u;
                sfSigma = 1;
                sfRd = Math.max(fr.fixedR - ru, 0);
              } else if (piece === 1) {
                v = [
                  fr.innerScale * u[0],
                  fr.innerScale * u[1],
                  fr.innerScale * u[2],
                ];
                sfSigma = fr.innerSigma;
                sfRd = Math.max(ru - fr.outputR, 0);
              } else {
                if (ru < fr.midMinR) {
                  if (kind === SURFACE_FOLD_MANDELBOX) b += 26;
                  continue;
                }
                const invR2 = fr.fixedR2 / (ru * ru);
                v = [u[0] * invR2, u[1] * invR2, u[2] * invR2];
                sfSigma = ru * fr.invFixedR;
                sfRd = Math.max(Math.max(fr.fixedR - ru, ru - fr.outputR), 0);
              }
              if (kind === SURFACE_FOLD_MANDELBOX) boxSetup(v);
            }
            if (kind === SURFACE_FOLD_SPHEREFOLD) {
              candidate = v;
              branchRd = sfRd;
            } else {
              const bb = kind === SURFACE_FOLD_BOXFOLD ? b : b % 27;
              const sel = [bb % 3, ((bb / 3) | 0) % 3, (bb / 9) | 0];
              const pick = (axis: 0 | 1 | 2): number =>
                sel[axis] === 0
                  ? pre0[axis]
                  : sel[axis] === 1
                    ? pre1[axis]
                    : pre2[axis];
              const dist = (axis: 0 | 1 | 2): number =>
                sel[axis] === 0
                  ? Math.max(dUp[axis], dDn[axis])
                  : sel[axis] === 1
                    ? dUp[axis]
                    : dDn[axis];
              candidate = [pick(0), pick(1), pick(2)];
              const boxRd = Math.hypot(dist(0), dist(1), dist(2));
              branchRd =
                kind === SURFACE_FOLD_BOXFOLD
                  ? boxRd
                  : Math.max(sfRd, sfSigma * boxRd);
            }
            branchSigma = map.foldSigma * sfSigma;
          }
          const img: Vec3 = [
            im[0] * candidate[0] +
              im[1] * candidate[1] +
              im[2] * candidate[2] +
              it[0],
            im[3] * candidate[0] +
              im[4] * candidate[1] +
              im[5] * candidate[2] +
              it[1],
            im[6] * candidate[0] +
              im[7] * candidate[1] +
              im[8] * candidate[2] +
              it[2],
          ];
          const r = Math.hypot(img[0] - bcX, img[1] - bcY, img[2] - bcZ);
          let candidateFloor = pFloor;
          if (branchRd > 0) {
            candidateFloor = Math.max(candidateFloor, pScale * absW * branchRd);
          }
          let key = pScale * (r - R);
          if (candidateFloor > 0 && candidateFloor > key) key = candidateFloor;
          if (key < lbKey) {
            lbKey = key;
            lbR = r;
            lbAbsY = Math.abs(img[1]);
            lbQ = img;
            lbScale = pScale * branchSigma;
            lbFloor = candidateFloor;
          }
        }
      }
    }
    if (lbKey === Infinity) break;
    levels++;
    rings = Math.min(rings, lbR / R);
    sheets = Math.min(sheets, lbAbsY / R);
    if (lbR > de.escapeRadius) break;
    ch = lbQ;
    chScale = lbScale;
    chFloor = lbFloor;
  }
  return {
    rings: Math.min(1, Math.max(0, rings)),
    sheets: Math.min(1, Math.max(0, sheets)),
    levels,
  };
}

function hitCentroid(probe: PanelStats, size: number): Vec3 | null {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let count = 0;
  for (let i = 0; i < size * size; i++) {
    if (probe.status?.[i] !== PREVIEW_HIT || !probe.hitPos) continue;
    sx += probe.hitPos[i * 3];
    sy += probe.hitPos[i * 3 + 1];
    sz += probe.hitPos[i * 3 + 2];
    count++;
  }
  return count > 0 ? [sx / count, sy / count, sz / count] : null;
}

function refineAnchor(
  de: DistanceEstimator,
  eye: Vec3,
  rough: Vec3,
  stepScale: number,
  R: number,
): Vec3 {
  const delta: Vec3 = [rough[0] - eye[0], rough[1] - eye[1], rough[2] - eye[2]];
  const length = Math.hypot(...delta);
  if (!(length > 0)) return rough;
  const dir: Vec3 = [delta[0] / length, delta[1] / length, delta[2] / length];
  let t = length;
  let best = rough;
  let bestAbs = Infinity;
  for (let i = 0; i < 80; i++) {
    const p: Vec3 = [
      eye[0] + dir[0] * t,
      eye[1] + dir[1] * t,
      eye[2] + dir[2] * t,
    ];
    const d = de(p);
    const abs = Math.abs(d);
    if (!Number.isFinite(d) || abs >= bestAbs) break;
    best = p;
    bestAbs = abs;
    if (abs < R * 1e-7) break;
    t += d * stepScale;
  }
  return best;
}

function zoomDE(
  de: DistanceEstimator,
  centre: Vec3,
  k: number,
): DistanceEstimator {
  return (p) =>
    k * de([centre[0] + p[0] / k, centre[1] + p[1] / k, centre[2] + p[2] / k]);
}

interface SystemSpec {
  name: string;
  family: "affine" | "fold" | "final-lens";
  transforms: Transform[];
  final?: Transform;
  eye: Vec3;
  frame: number;
}
interface BuiltSystem {
  spec: SystemSpec;
  de: SurfaceDE;
  estimator: DistanceEstimator;
  R: number;
  target: Vec3;
  anchor: Vec3;
  ringsCalibration: NativeCalibration;
  sheetsCalibration: NativeCalibration;
}

function squashLens(): Transform {
  return {
    id: 99,
    position: [0, 0, 0],
    rotation: [0.3, 0.6, 0.2],
    scale: [1.1, 0.7, 1],
  };
}
const ALL_SYSTEMS: readonly SystemSpec[] = [
  {
    name: "menger",
    family: "affine",
    transforms: mengerSponge(),
    eye: [1.55, 1.1, 1.8],
    frame: 0.5,
  },
  {
    name: "mandelbox-pair",
    family: "fold",
    transforms: foldMandelboxPair(),
    eye: [1.55, 1.1, 1.8],
    frame: 0.55,
  },
  {
    name: "menger-lens",
    family: "final-lens",
    transforms: mengerSponge(),
    final: squashLens(),
    eye: [1.55, 1.1, 1.8],
    frame: 0.55,
  },
];
const selectedNames = new Set(
  (process.env.FINISH_PATTERN_SYSTEMS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const SYSTEMS =
  selectedNames.size === 0
    ? ALL_SYSTEMS
    : ALL_SYSTEMS.filter((s) => selectedNames.has(s.name));
if (SYSTEMS.length === 0) {
  throw new Error("FINISH_PATTERN_SYSTEMS did not name a known system");
}

function buildSystem(spec: SystemSpec): BuiltSystem {
  const de = buildSurfaceDE(spec.transforms, spec.final ?? null);
  const estimator: DistanceEstimator = deHasFolds(de)
    ? (p) => estimateDistance(de, p)
    : (p) => estimateDistanceRefined(de, p);
  const R = de.visibleBoundingRadius * 1.05;
  const target: Vec3 = de.final ? [0, 0, 0] : [...de.boundCenter];
  const probe = renderPreview(
    {
      de: estimator,
      boundingRadius: R,
      target,
      stepScale: de.stepScale,
      eyeOffset: spec.eye,
      zoom: spec.frame,
      collect: true,
      ao: false,
      shadow: false,
      fog: false,
    },
    PROBE_SIZE,
  );
  const centroid = hitCentroid(probe, PROBE_SIZE) ?? target;
  const candidates: Array<{
    p: Vec3;
    centroidDistance: number;
    rings: number;
    sheets: number;
  }> = [];
  const rings: number[] = [];
  const sheets: number[] = [];
  for (let i = 0; i < PROBE_SIZE * PROBE_SIZE; i++) {
    if (probe.status?.[i] !== PREVIEW_HIT || !probe.hitPos) continue;
    const p: Vec3 = [
      probe.hitPos[i * 3],
      probe.hitPos[i * 3 + 1],
      probe.hitPos[i * 3 + 2],
    ];
    const info = hitInfo(de, p);
    rings.push(info.rings);
    sheets.push(info.sheets);
    const centroidDistance = Math.hypot(
      p[0] - centroid[0],
      p[1] - centroid[1],
      p[2] - centroid[2],
    );
    candidates.push({
      p,
      centroidDistance,
      rings: info.rings,
      sheets: info.sheets,
    });
  }
  const eye: Vec3 = [
    target[0] + spec.eye[0] * R,
    target[1] + spec.eye[1] * R,
    target[2] + spec.eye[2] * R,
  ];
  // A coarse accepted hit can still be R/size off the true set, and 64x
  // magnifies that residual. Refine several central hits and let residual
  // dominate the pick; centrality only breaks near-equal residuals so the
  // chosen close-up is still representative rather than an isolated spike.
  const ringsCalibration = calibrateNativeCarrier(rings);
  const sheetsCalibration = calibrateNativeCarrier(sheets);
  const carrierScore = (candidate: (typeof candidates)[number]): number =>
    Math.abs(
      normalizeNativeCarrier(candidate.sheets, sheetsCalibration) - 0.5,
    ) +
    0.2 *
      Math.abs(
        normalizeNativeCarrier(candidate.rings, ringsCalibration) - 0.5,
      ) +
    (candidate.centroidDistance / R) * 0.05;
  const refined = candidates
    .sort((a, b) => carrierScore(a) - carrierScore(b))
    .slice(0, 48)
    .map((candidate) => {
      const p = refineAnchor(estimator, eye, candidate.p, de.stepScale, R);
      return {
        p,
        score: (Math.abs(estimator(p)) / R) * 1e6 + carrierScore(candidate),
      };
    })
    .sort((a, b) => a.score - b.score);
  const anchor = refined[0]?.p ?? centroid;
  return {
    spec,
    de,
    estimator,
    R,
    target,
    anchor,
    ringsCalibration,
    sheetsCalibration,
  };
}

interface CachedHit {
  hit: PreviewHit;
  world: Vec3;
  objectP: Vec3;
  rings: number;
  sheets: number;
}
interface GeometryRung {
  zoom: number;
  stats: PanelStats;
  hits: Array<CachedHit | undefined>;
  components: Int32Array;
}

/** Label adjacent pixels only when their source/object points are local. */
function continuousComponents(
  hits: readonly (CachedHit | undefined)[],
): Int32Array {
  const labels = new Int32Array(hits.length);
  const stack: number[] = [];
  let nextLabel = 0;
  for (let seed = 0; seed < hits.length; seed++) {
    if (!hits[seed] || labels[seed] !== 0) continue;
    labels[seed] = ++nextLabel;
    stack.push(seed);
    while (stack.length > 0) {
      const at = stack.pop()!;
      const here = hits[at]!;
      const x = at % SIZE;
      for (const step of [-1, 1, -SIZE, SIZE]) {
        if ((step === -1 && x === 0) || (step === 1 && x === SIZE - 1))
          continue;
        const to = at + step;
        if (to < 0 || to >= hits.length || labels[to] !== 0 || !hits[to])
          continue;
        const there = hits[to];
        if (
          Math.hypot(
            here.objectP[0] - there.objectP[0],
            here.objectP[1] - there.objectP[1],
            here.objectP[2] - there.objectP[2],
          ) > 0.12
        ) {
          continue;
        }
        labels[to] = nextLabel;
        stack.push(to);
      }
    }
  }
  return labels;
}

function renderGeometry(sys: BuiltSystem, zoom: number): GeometryRung {
  const estimator =
    zoom === 1 ? sys.estimator : zoomDE(sys.estimator, sys.anchor, zoom);
  const target: Vec3 = zoom === 1 ? sys.target : [0, 0, 0];
  const hits = new Array<CachedHit | undefined>(SIZE * SIZE).fill(undefined);
  const shade = (hit: PreviewHit): Vec3 => {
    const world: Vec3 =
      zoom === 1
        ? hit.p
        : [
            sys.anchor[0] + hit.p[0] / zoom,
            sys.anchor[1] + hit.p[1] / zoom,
            sys.anchor[2] + hit.p[2] / zoom,
          ];
    const source = sourcePoint(sys.de, world);
    const info = hitInfo(sys.de, world);
    hits[hit.py * SIZE + hit.px] = {
      hit,
      world,
      objectP: [
        (source[0] - sys.de.boundCenter[0]) / sys.de.boundingRadius,
        (source[1] - sys.de.boundCenter[1]) / sys.de.boundingRadius,
        (source[2] - sys.de.boundCenter[2]) / sys.de.boundingRadius,
      ],
      rings: info.rings,
      sheets: info.sheets,
    };
    return finishShadeTs(
      BASES.none,
      hit.n,
      hit.rd,
      hit.shadow,
      hit.ao,
      hit.bg,
      CLASSIC_SURFACE_FINISH,
      { ...ENV_BASE, lightDir: hit.light },
    );
  };
  const stats = renderPreview(
    {
      de: estimator,
      boundingRadius: sys.R,
      target,
      stepScale: sys.de.stepScale,
      eyeOffset: sys.spec.eye,
      zoom: sys.spec.frame,
      ao: false,
      shadow: false,
      fog: false,
      shade,
    },
    SIZE,
  );
  return { zoom, stats, hits, components: continuousComponents(hits) };
}

const luminance = (c: Vec3): number =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function variance(values: Float32Array, mask: Uint8Array): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (!mask[i]) continue;
    sum += values[i];
    sumSq += values[i] * values[i];
    count++;
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

/** Component-aware separable box blur for the metric pyramid. */
function boxBlur(
  values: Float32Array,
  mask: Uint8Array,
  components: Int32Array,
  size: number,
  radius: number,
): Float32Array {
  const horizontalSum = new Float64Array(values.length);
  const horizontalCount = new Uint16Array(values.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!mask[i]) continue;
      const component = components[i];
      for (
        let xx = Math.max(0, x - radius);
        xx <= Math.min(size - 1, x + radius);
        xx++
      ) {
        const j = y * size + xx;
        if (components[j] !== component) continue;
        horizontalSum[i] += values[j];
        horizontalCount[i]++;
      }
    }
  }
  const out = new Float32Array(values.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!mask[i]) continue;
      const component = components[i];
      let sum = 0;
      let count = 0;
      for (
        let yy = Math.max(0, y - radius);
        yy <= Math.min(size - 1, y + radius);
        yy++
      ) {
        const j = yy * size + x;
        if (components[j] !== component) continue;
        sum += horizontalSum[j];
        count += horizontalCount[j];
      }
      out[i] = count > 0 ? sum / count : values[i];
    }
  }
  return out;
}

function differenceEnergy(
  a: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
): number {
  const delta = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) if (mask[i]) delta[i] = a[i] - b[i];
  return variance(delta, mask);
}

interface ResidualMetrics {
  residualVariance: number;
  edgeDensity: number;
  edgeThreshold: number;
  fineEnergyShare: number;
  midEnergyShare: number;
  lowEnergyShare: number;
}

/** Lighting-independent pattern-effect metric over pre-lighting albedo. */
function residualMetrics(
  residual: Float32Array,
  mask: Uint8Array,
  components: Int32Array,
  size: number,
): ResidualMetrics {
  const residualVariance = variance(residual, mask);
  const sigma = Math.sqrt(residualVariance);
  const edgeThreshold = Math.max(0.0015, sigma * 0.24);
  let pairs = 0;
  let edges = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!mask[i]) continue;
      if (x + 1 < size && components[i + 1] === components[i]) {
        pairs++;
        if (Math.abs(residual[i + 1] - residual[i]) > edgeThreshold) edges++;
      }
      if (y + 1 < size && components[i + size] === components[i]) {
        pairs++;
        if (Math.abs(residual[i + size] - residual[i]) > edgeThreshold) edges++;
      }
    }
  }
  const b2 = boxBlur(residual, mask, components, size, 2);
  const b4 = boxBlur(residual, mask, components, size, 4);
  const b8 = boxBlur(residual, mask, components, size, 8);
  const b16 = boxBlur(residual, mask, components, size, 16);
  const fine = differenceEnergy(residual, b2, mask);
  const mid =
    differenceEnergy(b2, b4, mask) +
    differenceEnergy(b4, b8, mask) +
    differenceEnergy(b8, b16, mask);
  const low = variance(b16, mask);
  const total = fine + mid + low;
  return {
    residualVariance,
    edgeDensity: pairs > 0 ? edges / pairs : 0,
    edgeThreshold,
    fineEnergyShare: total > 0 ? fine / total : 0,
    midEnergyShare: total > 0 ? mid / total : 0,
    lowEnergyShare: total > 0 ? low / total : 0,
  };
}

type PanelMode = "hybrid" | "macro-only" | "world-control";
interface PanelSpec {
  kind: PatternKind;
  mode: PanelMode;
  zoom: number;
}
interface RenderedPanel {
  spec: PanelSpec;
  stats: PanelStats;
  metrics: ResidualMetrics;
  meanDetailGate: number;
  meanDetailMix: number;
  nativeVariance: number;
  pass: boolean;
  checks: string[];
}

function renderPatternPanel(
  sys: BuiltSystem,
  geometry: GeometryRung,
  spec: PanelSpec,
): RenderedPanel {
  const base = BASES[spec.kind];
  const rgb = geometry.stats.rgb.slice();
  const residual = new Float32Array(SIZE * SIZE);
  const mask = new Uint8Array(SIZE * SIZE);
  const nativeValues = new Float32Array(SIZE * SIZE);
  let gateSum = 0;
  let detailMixSum = 0;
  let count = 0;
  const params: PatternParams = {
    kind: spec.kind,
    axis: "y",
    scale: spec.kind === "none" ? 0 : PATTERN_DEFAULT_SCALE[spec.kind],
    strength: spec.kind === "none" ? 0 : 1,
  };
  for (let i = 0; i < geometry.hits.length; i++) {
    const sample = geometry.hits[i];
    if (!sample) continue;
    const objectP: Vec3 =
      spec.mode === "world-control"
        ? [
            sample.world[0] / sys.R,
            sample.world[1] / sys.R,
            sample.world[2] / sys.R,
          ]
        : sample.objectP;
    const footprint =
      (2 * sys.spec.frame * Math.max(sample.hit.t / sys.R, 1)) /
      (SIZE * spec.zoom);
    const detailMode: PatternDetailMode =
      spec.mode === "hybrid" ? "hybrid" : "macro-only";
    const result = evaluateSurfacePattern(
      base,
      params,
      {
        objectP,
        rings: sample.rings,
        sheets: sample.sheets,
        ringsCalibration: sys.ringsCalibration,
        sheetsCalibration: sys.sheetsCalibration,
        pixelFootprint: footprint,
      },
      detailMode,
    );
    const shaded = finishShadeTs(
      result.albedo,
      sample.hit.n,
      sample.hit.rd,
      sample.hit.shadow,
      sample.hit.ao,
      sample.hit.bg,
      CLASSIC_SURFACE_FINISH,
      { ...ENV_BASE, lightDir: sample.hit.light },
    );
    const at = i * 3;
    rgb[at] = Math.max(0, Math.min(255, Math.round(255 * shaded[0])));
    rgb[at + 1] = Math.max(0, Math.min(255, Math.round(255 * shaded[1])));
    rgb[at + 2] = Math.max(0, Math.min(255, Math.round(255 * shaded[2])));
    residual[i] = luminance(result.albedo) - luminance(base);
    nativeValues[i] = result.nativeValue;
    mask[i] = 1;
    gateSum += result.detailGate;
    detailMixSum += result.detailMix;
    count++;
  }
  const metrics = residualMetrics(residual, mask, geometry.components, SIZE);
  const checks: string[] = [];
  if (geometry.stats.hits <= MIN_HIT_FRACTION * SIZE * SIZE)
    checks.push("hit-coverage");
  if (spec.kind === "none" && metrics.residualVariance > 1e-12) {
    checks.push("none-not-identity");
  }
  if (spec.kind !== "none" && spec.mode === "hybrid" && spec.zoom === 1) {
    if (
      metrics.edgeDensity < EDGE_DENSITY_MIN ||
      metrics.edgeDensity > EDGE_DENSITY_MAX
    ) {
      checks.push("ordinary-edge-density");
    }
    if (metrics.midEnergyShare < MID_ENERGY_MIN) checks.push("midscale-energy");
    if (metrics.fineEnergyShare > FINE_ENERGY_MAX) checks.push("fine-energy");
  }
  return {
    spec,
    stats: { ...geometry.stats, rgb },
    metrics,
    meanDetailGate: count > 0 ? gateSum / count : 0,
    meanDetailMix: count > 0 ? detailMixSum / count : 0,
    nativeVariance: variance(nativeValues, mask),
    pass: checks.length === 0,
    checks,
  };
}

function panelSpecs(): PanelSpec[] {
  const heroes: PanelSpec[] = [];
  for (const kind of ["none", "wood", "marble", "strata"] as const) {
    for (const zoom of ZOOMS) heroes.push({ kind, mode: "hybrid", zoom });
  }
  const controls: PanelSpec[] = [];
  for (const kind of ["wood", "marble", "strata"] as const) {
    for (const mode of ["macro-only", "world-control"] as const) {
      for (const zoom of [1, 64]) controls.push({ kind, mode, zoom });
    }
  }
  return [...heroes, ...controls];
}

function compactLabel(panel: RenderedPanel): readonly [string, string] {
  const mode =
    panel.spec.mode === "hybrid"
      ? "HYBRID"
      : panel.spec.mode === "macro-only"
        ? "MACRO"
        : "WORLD";
  return [
    `${panel.spec.kind} ${mode}`,
    `${panel.spec.zoom}X E${(100 * panel.metrics.edgeDensity).toFixed(0)} V${panel.metrics.residualVariance.toFixed(3)}`,
  ];
}

interface PanelManifest {
  system: string;
  family: SystemSpec["family"];
  kind: PatternKind;
  mode: PanelMode;
  zoom: number;
  metrics: ResidualMetrics;
  meanDetailGate: number;
  meanDetailMix: number;
  nativeVariance: number;
  hits: number;
  hitFraction: number;
  exhausted: number;
  pass: boolean;
  checks: string[];
}
interface SystemManifest {
  name: string;
  family: SystemSpec["family"];
  artifact: string;
  radius: number;
  frame: number;
  anchor: Vec3;
  calibration: { rings: NativeCalibration; sheets: NativeCalibration };
  geometryMs: Record<string, number>;
  panels: PanelManifest[];
  ladderChecks: Array<{
    kind: Exclude<PatternKind, "none">;
    rungRetention: number[];
    endRetention: number;
    pass: boolean;
  }>;
}

const systemManifests: SystemManifest[] = [];
const reviewHeroes: Array<{ system: string; kind: string; panel: PanelStats }> =
  [];

function reviewOrder(key: string): number {
  let hash = 2166136261;
  for (const ch of `${RUN_ID}:${key}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function report(sys: BuiltSystem, panel: RenderedPanel): void {
  const m = panel.metrics;
  console.log(
    `  ${sys.spec.name.padEnd(16)} ${panel.spec.kind.padEnd(7)} ${panel.spec.mode.padEnd(13)} ` +
      `${`${panel.spec.zoom}x`.padStart(3)} hits ${((100 * panel.stats.hits) / (SIZE * SIZE)).toFixed(1).padStart(5)}% ` +
      `var ${m.residualVariance.toFixed(4)} edge ${(100 * m.edgeDensity).toFixed(1).padStart(5)}% ` +
      `energy fine/mid ${m.fineEnergyShare.toFixed(2)}/${m.midEnergyShare.toFixed(2)} ` +
      `gate ${panel.meanDetailGate.toFixed(2)} nativeVar ${panel.nativeVariance.toFixed(4)} ` +
      `${panel.pass ? "PASS" : `FAIL ${panel.checks.join(",")}`}`,
  );
}

describe("hybrid finish pattern evidence", () => {
  for (const spec of SYSTEMS) {
    it(`renders and measures ${spec.name} (${spec.family})`, () => {
      const sys = buildSystem(spec);
      console.log(
        `  ${spec.name}: ${spec.family}, size ${SIZE}, R ${sys.R.toFixed(3)}, ` +
          `native rings ${sys.ringsCalibration.enabled ? "on" : "OFF"} ` +
          `[${sys.ringsCalibration.low.toFixed(3)}, ${sys.ringsCalibration.high.toFixed(3)}], ` +
          `sheets ${sys.sheetsCalibration.enabled ? "on" : "OFF"} ` +
          `[${sys.sheetsCalibration.low.toFixed(3)}, ${sys.sheetsCalibration.high.toFixed(3)}]`,
      );
      const geometry = new Map<number, GeometryRung>();
      for (const zoom of ZOOMS) {
        const rung = renderGeometry(sys, zoom);
        geometry.set(zoom, rung);
        expect
          .soft(
            rung.stats.hits,
            `${spec.name} ${zoom}x rendered too little geometry`,
          )
          .toBeGreaterThan(MIN_HIT_FRACTION * SIZE * SIZE);
        expect
          .soft(rung.stats.exhausted, `${spec.name} ${zoom}x exhausted rays`)
          .toBe(0);
      }
      const panels = panelSpecs().map((specification) => {
        const panel = renderPatternPanel(
          sys,
          geometry.get(specification.zoom)!,
          specification,
        );
        report(sys, panel);
        expect
          .soft(
            panel.pass,
            `${spec.name} ${specification.kind} ${specification.mode} ${specification.zoom}x: ${panel.checks.join(", ")}`,
          )
          .toBe(true);
        if (
          specification.mode === "hybrid" &&
          specification.zoom === 1 &&
          specification.kind !== "none"
        ) {
          reviewHeroes.push({
            system: spec.name,
            kind: specification.kind,
            panel: panel.stats,
          });
        }
        return panel;
      });

      const ladderChecks: SystemManifest["ladderChecks"] = [];
      for (const kind of ["wood", "marble", "strata"] as const) {
        const ladder = panels.filter(
          (p) => p.spec.kind === kind && p.spec.mode === "hybrid",
        );
        const variances = ladder.map((p) => p.metrics.residualVariance);
        const rungRetention = variances
          .slice(1)
          .map((v, i) => v / Math.max(variances[i], 1e-12));
        const endRetention = variances[3] / Math.max(variances[0], 1e-12);
        const pass =
          rungRetention.every((r) => r >= RUNG_VARIANCE_RETENTION_MIN) &&
          endRetention >= END_VARIANCE_RETENTION_MIN;
        console.log(
          `  ${spec.name} ${kind} variance retention 4/1 16/4 64/16 = ` +
            `${rungRetention.map((r) => r.toFixed(2)).join(" / ")}; 64/1 ${endRetention.toFixed(2)} ${pass ? "PASS" : "FAIL"}`,
        );
        expect
          .soft(endRetention, `${spec.name} ${kind}: 64x retained <50% of 1x`)
          .toBeGreaterThanOrEqual(END_VARIANCE_RETENTION_MIN);
        for (let i = 0; i < rungRetention.length; i++) {
          expect
            .soft(
              rungRetention[i],
              `${spec.name} ${kind}: rung ${ZOOMS[i + 1]}x/${ZOOMS[i]}x retained <60%`,
            )
            .toBeGreaterThanOrEqual(RUNG_VARIANCE_RETENTION_MIN);
        }
        ladderChecks.push({ kind, rungRetention, endRetention, pass });
      }

      const artifact = join(RUN_DIR_NAME, `${spec.name}.png`);
      const file = writeLabeledContactSheet(
        panels.map((panel) => ({
          stats: panel.stats,
          lines: compactLabel(panel),
        })),
        4,
        artifact,
      );
      console.log(`  wrote ${file}`);
      systemManifests.push({
        name: spec.name,
        family: spec.family,
        artifact: relative(OUT_ROOT, file),
        radius: sys.R,
        frame: spec.frame,
        anchor: sys.anchor,
        calibration: {
          rings: sys.ringsCalibration,
          sheets: sys.sheetsCalibration,
        },
        geometryMs: Object.fromEntries(
          [...geometry].map(([zoom, rung]) => [`${zoom}x`, rung.stats.ms]),
        ),
        panels: panels.map((panel) => ({
          system: spec.name,
          family: spec.family,
          kind: panel.spec.kind,
          mode: panel.spec.mode,
          zoom: panel.spec.zoom,
          metrics: panel.metrics,
          meanDetailGate: panel.meanDetailGate,
          meanDetailMix: panel.meanDetailMix,
          nativeVariance: panel.nativeVariance,
          hits: panel.stats.hits,
          hitFraction: panel.stats.hits / (SIZE * SIZE),
          exhausted: panel.stats.exhausted,
          pass: panel.pass,
          checks: panel.checks,
        })),
        ladderChecks,
      });
    });
  }

  afterAll(() => {
    const cardPanels = [...reviewHeroes]
      .sort(
        (a, b) =>
          reviewOrder(`${a.kind}:${a.system}`) -
          reviewOrder(`${b.kind}:${b.system}`),
      )
      .map((hero, i) => ({
        ...hero,
        card: `CARD ${String(i + 1).padStart(2, "0")}`,
      }));
    let reviewArtifact: string | null = null;
    if (cardPanels.length > 0) {
      const file = writeLabeledContactSheet(
        cardPanels.map((card) => ({
          stats: card.panel,
          lines: [card.card, "CHOICE CONF1-5"],
        })),
        3,
        join(RUN_DIR_NAME, "review-cards.png"),
      );
      reviewArtifact = relative(OUT_ROOT, file);
    }
    const manifest = {
      schema: 1,
      runId: RUN_ID,
      generatedAt: new Date().toISOString(),
      completeMatrix: SYSTEMS.length === ALL_SYSTEMS.length,
      selectedSystems: SYSTEMS.map((s) => s.name),
      size: SIZE,
      zooms: ZOOMS,
      constants: {
        noiseOctaves: PATTERN_NOISE_OCTAVES,
        latticeHashesPerMacroSample: {
          wood: 24,
          marble: 48,
          strata: 24,
        },
        defaultScale: PATTERN_DEFAULT_SCALE,
        nativePeriods: PATTERN_NATIVE_PERIODS,
        nativeDetailMix: PATTERN_DETAIL_MIX,
        detailFootprintFull: PATTERN_DETAIL_FOOTPRINT_FULL,
        detailFootprintOff: PATTERN_DETAIL_FOOTPRINT_OFF,
        calibrationPercentiles: [0.03, 0.97],
      },
      thresholds: {
        ordinaryEdgeDensity: [EDGE_DENSITY_MIN, EDGE_DENSITY_MAX],
        minimumMidscaleEnergy: MID_ENERGY_MIN,
        maximumFineEnergy: FINE_ENERGY_MAX,
        minimumRungVarianceRetention: RUNG_VARIANCE_RETENTION_MIN,
        minimum64xVarianceRetention: END_VARIANCE_RETENTION_MIN,
      },
      metric: {
        residual: "pre-lighting albedo luminance minus plain-base luminance",
        note: "This is lighting-independent rather than merely lighting-normalized.",
        energyBands:
          "masked box-pyramid: residual->2px is fine; 2->4->8->16px is mid; 16px is low",
      },
      systems: systemManifests,
      humanReview: {
        required: true,
        artifact: reviewArtifact,
        choices: ["Wood", "Marble", "Strata", "Noise-corrosion", "Plain-other"],
        reviewersRequired: 5,
        heroRule: "at least 4/5 correct with median confidence >=3",
        aggregateRule: "at least 80% correct, no system below 3/5",
        cards: cardPanels.map((card) => ({
          card: card.card,
          expected: card.kind,
          system: card.system,
        })),
        status: "pending external blinded review",
      },
    };
    const manifestFile = join(RUN_DIR, "manifest.json");
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`  wrote ${manifestFile}`);
  });
});
