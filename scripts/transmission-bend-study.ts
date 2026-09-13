/**
 * Harness-only world-space continuation through an artistic thin interface.
 *
 * The displacement is derived from a virtual parallel slab, but only its
 * lateral component is applied at unchanged forward ray parameter. This is a
 * zero-thickness appearance mapping, not a claim about an unknown glass volume.
 * Rear geometry and terminal radiance are queried on the displaced world ray.
 */
import {
  finishShadeTs,
  resolveSurfaceFinish,
} from "../src/fractal/surface-finish";
import { PREVIEW_EXHAUSTED, PREVIEW_MISS, renderPreview } from "./de-preview";
import type {
  PanelStats,
  PreviewRegion,
  PreviewScene,
  Vec3,
} from "./de-preview";
import { CLEARANCE_BAND_CONTRACT } from "./transmission-gpu-contract";
import {
  clearanceLayerSignal,
  layerOpticalIncrement,
  layerThroughput,
} from "./transmission-layer-field";

const SKY: Vec3 = [0.1, 0.14, 0.2];
const BOTTOM: Vec3 = [0.025, 0.035, 0.055];
const FINISH = resolveSurfaceFinish({
  specular: 1,
  shininess: 128,
  reflect: 0.5,
});
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const linear = (c: Vec3): Vec3 => c.map((v) => Math.max(0, v) ** 2.2) as Vec3;
const encode = (c: Vec3): Vec3 =>
  c.map((v) => Math.max(0, v) ** (1 / 2.2)) as Vec3;
const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const norm = (v: Vec3): Vec3 => {
  const magnitude = length(v);
  return magnitude > 0 ? (v.map((x) => x / magnitude) as Vec3) : [0, 0, 0];
};

export interface BendMaterial {
  color: Vec3;
  opaque?: boolean;
  /** Stable harness attribution such as `front`, `rear`, or `fractal`. */
  label: string;
}

export interface BendFixture {
  name: string;
  scene: PreviewScene;
  material: (p: Vec3) => BendMaterial;
  /** Optional analytic opaque-control predicate, sampled on the same fixed
   * world grid before the appearance field. It is not a fractal membership
   * inference and exists to detect accidental forward continuation jumps. */
  opaqueStop?: (p: Vec3) => BendMaterial | null;
}

export interface BendOptions {
  transmit?: number;
  ior?: number;
  /** Virtual slab thickness used only to derive lateral displacement. */
  slabFraction?: number;
  /** Smooth world-space bound on the lateral appearance displacement. */
  maxOffsetFraction?: number;
  opticalNormalFraction?: number;
  bendOnset?: "none" | "weighted" | "hard";
  maxLayers?: number;
  /** Samples between resumable renderPreview work chunks. */
  chunkSteps?: number;
  /** Independent per-ray sampled-domain guard. */
  maxSamples?: number;
  /** Independent whole-panel renderPreview continuation guard. */
  maxChunks?: number;
  residualTolerance?: number;
  terminalRadiance?: (origin: Vec3, rd: Vec3, py: number, size: number) => Vec3;
}

export interface SlabDisplacement {
  delta: Vec3;
  rawMagnitude: number;
  limited: boolean;
}

/**
 * Difference between straight and refracted intersections with a virtual
 * parallel plane. It is represented directly in the incident tangent plane,
 * then smoothly saturated in world units. The saved forward parameter is
 * unchanged; for IOR >= 1 the displacement has no interface-normal component
 * and never advances along the incident ray (its direction dot is <= 0).
 */
export function virtualSlabLateralDelta(
  direction: Vec3,
  normal: Vec3,
  ior: number,
  thickness: number,
  maxOffset: number,
): SlabDisplacement {
  if (
    ![...direction, ...normal].every(Number.isFinite) ||
    !Number.isFinite(ior) ||
    ior < 1 ||
    !Number.isFinite(thickness) ||
    thickness < 0 ||
    !Number.isFinite(maxOffset) ||
    maxOffset < 0
  )
    throw new Error(
      "Virtual slab requires finite nonnegative dimensions and IOR >= 1",
    );
  const rd = norm(direction);
  let n = norm(normal);
  if (
    length(rd) === 0 ||
    length(n) === 0 ||
    ior === 1 ||
    thickness === 0 ||
    maxOffset === 0
  )
    return { delta: [0, 0, 0], rawMagnitude: 0, limited: false };
  if (dot(n, rd) > 0) n = n.map((v) => -v) as Vec3;
  const cosI = Math.max(0, Math.min(1, -dot(n, rd)));
  const tangent = rd.map((v, axis) => v + cosI * n[axis]) as Vec3;
  const tangentMagnitude = length(tangent);
  if (tangentMagnitude <= Number.EPSILON)
    return { delta: [0, 0, 0], rawMagnitude: 0, limited: false };
  const eta = 1 / ior;
  const cosT = Math.sqrt(Math.max(0, 1 - eta * eta * (1 - cosI * cosI)));
  const coefficient = cosI > 0 ? eta / cosT - 1 / cosI : -Infinity;
  const rawMagnitude = Math.abs(coefficient) * thickness * tangentMagnitude;
  const boundedMagnitude = maxOffset * Math.tanh(rawMagnitude / maxOffset);
  const sign = coefficient < 0 ? -1 : 1;
  const delta = tangent.map(
    (v) => (sign * boundedMagnitude * v) / tangentMagnitude,
  ) as Vec3;
  return {
    delta,
    rawMagnitude,
    limited: !Number.isFinite(rawMagnitude) || rawMagnitude > maxOffset,
  };
}

export interface BendPanel {
  stats: PanelStats;
  calls: number;
  unresolved: number;
  rearHits: number;
  frontThenGuard: number;
  attributionCounts: Record<string, number>;
  rearMask: Uint8Array;
  frontThenGuardMask: Uint8Array;
  bendMask: Uint8Array;
  variation: Float64Array;
  bendStrength: Float64Array;
  throughput: Float64Array;
  eventCounts: Uint16Array;
  sampleCounts: Uint32Array;
  work: {
    field: number;
    outsideDomainGrid: number;
    opticalNormal: number;
    shade: number;
    attribution: number;
    opaqueControl: number;
    terminal: number;
    chunks: number;
    worstRay: number;
  };
  termination: {
    domainComplete: number;
    opaque: number;
    residual: number;
    unresolved: number;
    noIntersection: number;
    layerCap: number;
    sampleCap: number;
    chunkCap: number;
  };
  bending: {
    onset: "none" | "weighted" | "hard";
    bentPixels: number;
    reversalStops: number;
    offsetLimitedPixels: number;
    maximumLateralFraction: number;
    meanStrength: number;
    convention: string;
  };
  sampling: {
    deltaFraction: number;
    chunkSteps: number;
    maxSamples: number;
    maxChunks: number;
    shiftedDomainPolicy: string;
  };
}

type Termination = keyof BendPanel["termination"];
interface State {
  origin: Vec3;
  rd: Vec3;
  entry: number;
  domainEntry: number;
  end: number;
  sampleIndex: number;
  active: boolean;
  eventDone: boolean;
  events: number;
  previousSignal: number;
  variation: number;
  throughput: number;
  color: Vec3;
  bent: boolean;
  bendStrength: number;
  fullDelta?: SlabDisplacement;
  approachStarted: boolean;
  approachOpen: boolean;
  reversalStop: boolean;
  rear: boolean;
  seenFront: boolean;
  frontThenGuard: boolean;
  samples: number;
  work: number;
  unresolved: boolean;
  terminalApplied: boolean;
  termination?: Termination;
  pending?: { point: Vec3; normal: Vec3; material: BendMaterial; tau: number };
}

function sphereInterval(
  origin: Vec3,
  rd: Vec3,
  center: Vec3,
  radius: number,
): [number, number] | null {
  const o = origin.map((v, i) => v - center[i]) as Vec3;
  const b = dot(o, rd);
  const disc = b * b - dot(o, o) + radius * radius;
  if (disc <= 0) return null;
  const root = Math.sqrt(disc);
  const end = -b + root;
  return end > 0 ? [Math.max(0, -b - root), end] : null;
}

function opticalNormal(
  de: PreviewScene["de"],
  p: Vec3,
  h: number,
  count: () => void,
): Vec3 {
  const gradient: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const a = [...p] as Vec3;
    const b = [...p] as Vec3;
    a[axis] += h;
    b[axis] -= h;
    gradient.push(de(a) - de(b));
    count();
    count();
  }
  return norm(gradient as Vec3);
}

export function renderBentTransmission(
  fixture: BendFixture,
  size: number,
  options: BendOptions = {},
  region?: PreviewRegion,
): BendPanel {
  const transmit = options.transmit ?? 0.9;
  const ior = options.ior ?? 1.45;
  const slabFraction = options.slabFraction ?? 0.08;
  const maxOffsetFraction = options.maxOffsetFraction ?? 0.08;
  const normalFraction = options.opticalNormalFraction ?? 0.04;
  const onset = options.bendOnset ?? "weighted";
  const maxLayers = options.maxLayers ?? 64;
  const chunkSteps = options.chunkSteps ?? 1200;
  const maxSamples = options.maxSamples ?? 4096;
  const maxChunks =
    options.maxChunks ?? maxLayers + Math.ceil(maxSamples / chunkSteps) + 8;
  const residual = options.residualTolerance ?? 0;
  if (
    ![
      transmit,
      ior,
      slabFraction,
      maxOffsetFraction,
      normalFraction,
      residual,
    ].every(Number.isFinite) ||
    transmit < 0 ||
    transmit > 1 ||
    ior < 1 ||
    slabFraction < 0 ||
    maxOffsetFraction < 0 ||
    normalFraction <= 0 ||
    residual < 0 ||
    residual >= 1 ||
    !Number.isInteger(size) ||
    size < 1 ||
    !Number.isInteger(maxLayers) ||
    maxLayers < 1 ||
    !Number.isInteger(chunkSteps) ||
    chunkSteps < 1 ||
    !Number.isInteger(maxSamples) ||
    maxSamples < 1 ||
    !Number.isInteger(maxChunks) ||
    maxChunks < 1
  )
    throw new Error("Invalid bend-study optics or work bounds");
  const R = fixture.scene.boundingRadius;
  if (
    !Number.isFinite(R) ||
    R <= 0 ||
    !Number.isFinite(fixture.scene.stepScale) ||
    fixture.scene.stepScale <= 0
  )
    throw new Error(
      "Bend-study sampling requires finite positive radius and step scale",
    );
  const center = fixture.scene.boundingCenter ??
    fixture.scene.target ?? [0, 0, 0];
  const delta = R * CLEARANCE_BAND_CONTRACT.sampleRadiusFraction;
  const outputRegion = region ?? { x: 0, y: 0, width: size, height: size };
  if (
    !Object.values(outputRegion).every(Number.isInteger) ||
    outputRegion.x < 0 ||
    outputRegion.y < 0 ||
    outputRegion.width < 1 ||
    outputRegion.height < 1 ||
    outputRegion.x + outputRegion.width > size ||
    outputRegion.y + outputRegion.height > size
  )
    throw new Error("Bend-study region must lie inside the full image");
  const states = new Map<string, State>();
  const pixels = new Array<State>(outputRegion.width * outputRegion.height);
  let current: State;
  let panel: PanelStats | undefined;
  let calls = 0;
  let totalSteps = 0;
  let totalEvals = 0;
  let totalMs = 0;
  const work = {
    field: 0,
    outsideDomainGrid: 0,
    opticalNormal: 0,
    shade: 0,
    attribution: 0,
    opaqueControl: 0,
    terminal: 0,
    chunks: 0,
    worstRay: 0,
  };
  const termination: BendPanel["termination"] = {
    domainComplete: 0,
    opaque: 0,
    residual: 0,
    unresolved: 0,
    noIntersection: 0,
    layerCap: 0,
    sampleCap: 0,
    chunkCap: 0,
  };
  const attributionCounts: Record<string, number> = {};
  const mark = (state: State, reason: Termination) => {
    if (state.termination) return;
    state.termination = reason;
    termination[reason]++;
    if (
      reason === "layerCap" ||
      reason === "sampleCap" ||
      reason === "chunkCap"
    ) {
      termination.unresolved++;
      state.unresolved = true;
    }
  };
  const backdrop = (py: number): Vec3 => {
    const t = (py + 0.5) / size;
    return SKY.map(
      (v, i) => v ** 2.2 + (BOTTOM[i] ** 2.2 - v ** 2.2) * t,
    ) as Vec3;
  };
  const terminal = (state: State, py: number): Vec3 => {
    work.terminal++;
    state.work++;
    return (
      options.terminalRadiance?.(state.origin, state.rd, py, size) ??
      backdrop(py)
    );
  };

  for (let chunk = 0; chunk < maxChunks; chunk++) {
    for (const state of states.values())
      if (state.active) state.eventDone = false;
    work.chunks++;
    panel = renderPreview(
      {
        ...fixture.scene,
        normal: () => current.pending!.normal,
        maxSteps: chunkSteps,
        minimumStepFraction: 0,
        fog: false,
        shadow: false,
        ao: false,
        marchInterval(origin, rd, pixel) {
          const key = `${pixel.px},${pixel.py}`;
          current = states.get(key)!;
          if (!current) {
            const interval = sphereInterval(origin, rd, center, R);
            current = {
              origin,
              rd,
              entry: interval?.[0] ?? 0,
              domainEntry: interval?.[0] ?? 0,
              end: interval?.[1] ?? 0,
              sampleIndex: 0,
              active: Boolean(interval),
              eventDone: false,
              events: 0,
              previousSignal: 0,
              variation: 0,
              throughput: 1,
              color: [0, 0, 0],
              bent: false,
              bendStrength: 0,
              approachStarted: false,
              approachOpen: true,
              reversalStop: false,
              rear: false,
              seenFront: false,
              frontThenGuard: false,
              samples: 0,
              work: 0,
              unresolved: false,
              terminalApplied: false,
            };
            if (!interval) mark(current, "noIntersection");
            states.set(key, current);
          }
          if (!current.active || current.eventDone) return null;
          return [0, 4 * R];
        },
        march() {
          const t = current.entry + current.sampleIndex * delta;
          if (current.sampleIndex >= maxSamples) {
            current.active = false;
            mark(current, "sampleCap");
            return { d: 1e20, stride: (4 * R) / fixture.scene.stepScale };
          }
          if (!(t < current.end))
            return { d: 1e20, stride: (4 * R) / fixture.scene.stepScale };
          current.samples++;
          current.work++;
          current.sampleIndex++;
          // Lateral displacement can put an unchanged lattice point before
          // the shifted sphere entry. Keep the original phase/index, define
          // that out-of-domain signal as zero, and do not query the DE there.
          if (t < current.domainEntry) {
            work.outsideDomainGrid++;
            if (
              onset === "weighted" &&
              current.approachOpen &&
              current.approachStarted &&
              current.previousSignal > 0
            ) {
              current.approachOpen = false;
              current.reversalStop = true;
              current.bent = current.bendStrength > 0;
            }
            current.previousSignal = 0;
            return { d: 1e20, stride: delta / fixture.scene.stepScale };
          }
          const point = current.origin.map(
            (value, axis) => value + current.rd[axis] * t,
          ) as Vec3;
          const distance = fixture.scene.de(point);
          calls++;
          work.field++;
          let opaqueMaterial: BendMaterial | null = null;
          if (fixture.opaqueStop) {
            work.opaqueControl++;
            current.work++;
            opaqueMaterial = fixture.opaqueStop(point);
          }
          const signal = clearanceLayerSignal(distance, R);
          const increment = layerOpticalIncrement(
            current.previousSignal,
            signal,
          );
          if (
            onset === "weighted" &&
            current.approachOpen &&
            current.approachStarted &&
            signal < current.previousSignal
          ) {
            current.approachOpen = false;
            current.reversalStop = true;
            current.bent = current.bendStrength > 0;
          }
          current.previousSignal = signal;
          if (increment === 0 && !opaqueMaterial)
            return { d: 1e20, stride: delta / fixture.scene.stepScale };
          if (increment > 0) {
            current.approachStarted = true;
            current.variation += increment;
          }
          let n = opticalNormal(
            fixture.scene.de,
            point,
            normalFraction * R,
            () => {
              calls++;
              work.opticalNormal++;
              current.work++;
            },
          );
          if (dot(n, current.rd) > 0) n = n.map((v) => -v) as Vec3;
          const fresnel =
            0.04 +
            0.96 * (1 - Math.max(0, Math.min(1, -dot(n, current.rd)))) ** 5;
          const material = opaqueMaterial ?? fixture.material(point);
          work.attribution++;
          current.work++;
          attributionCounts[material.label] =
            (attributionCounts[material.label] ?? 0) + 1;
          const baseTau = material.opaque ? 0 : transmit * (1 - fresnel);
          const tau = opaqueMaterial ? 0 : layerThroughput(baseTau, increment);
          current.pending = { point, normal: n, material, tau };
          current.eventDone = true;
          current.events++;
          if (material.label === "rear") current.rear = true;
          if (material.label === "front") current.seenFront = true;
          if (material.label === "guard" && current.seenFront)
            current.frontThenGuard = true;
          if (
            !current.bent &&
            onset !== "none" &&
            !material.opaque &&
            tau > 0
          ) {
            current.fullDelta ??= virtualSlabLateralDelta(
              current.rd,
              n,
              ior,
              slabFraction * R,
              maxOffsetFraction * R,
            );
            const oldStrength = current.bendStrength;
            current.bendStrength =
              onset === "hard"
                ? 1
                : Math.min(
                    1,
                    current.bendStrength +
                      (current.approachOpen ? increment : 0),
                  );
            const applied = current.bendStrength - oldStrength;
            current.origin = current.origin.map(
              (value, axis) => value + applied * current.fullDelta!.delta[axis],
            ) as Vec3;
            if (onset === "hard" || current.bendStrength >= 1) {
              current.bent = true;
              current.approachOpen = false;
            }
            const shifted = sphereInterval(
              current.origin,
              current.rd,
              center,
              R,
            );
            current.domainEntry = shifted?.[0] ?? current.entry;
            current.end = shifted?.[1] ?? current.entry;
          }
          return { d: 0, stride: delta / fixture.scene.stepScale };
        },
        shadeLinear(hit) {
          const pending = current.pending!;
          // An opaque/zero-throughput event cannot see rear radiance and must
          // not invoke a terminal callback whose result is fully occluded.
          const terminalLinear =
            pending.tau === 0 ? backdrop(hit.py) : terminal(current, hit.py);
          const local = linear(
            finishShadeTs(
              pending.material.color,
              pending.normal,
              current.rd,
              1,
              1,
              encode(terminalLinear),
              FINISH,
              {
                lightDir: hit.light,
                ambient: 0.25,
                envStrength: 0,
                bgTop: SKY,
                bgBottom: BOTTOM,
              },
            ),
          );
          work.shade++;
          current.work++;
          for (let channel = 0; channel < 3; channel++)
            current.color[channel] +=
              current.throughput * (1 - pending.tau) * local[channel];
          current.throughput *= pending.tau;
          if (pending.tau === 0) {
            current.active = false;
            mark(current, "opaque");
          } else if (current.throughput <= residual) {
            current.active = false;
            mark(current, "residual");
          } else if (current.events >= maxLayers) {
            current.active = false;
            mark(current, "layerCap");
          }
          return current.color;
        },
        rayLinear(ray) {
          const outputPixel =
            (ray.py - outputRegion.y) * outputRegion.width +
            ray.px -
            outputRegion.x;
          pixels[outputPixel] = current;
          if (
            current.active &&
            !current.eventDone &&
            ray.status === PREVIEW_MISS
          ) {
            const t = current.entry + current.sampleIndex * delta;
            if (!(t < current.end)) {
              const radiance = terminal(current, ray.py);
              for (let channel = 0; channel < 3; channel++)
                current.color[channel] +=
                  current.throughput * radiance[channel];
              current.active = false;
              current.terminalApplied = true;
              mark(current, "domainComplete");
            }
          }
          // Exhaustion is only a scheduling boundary. The exact integer grid
          // position and previous clearance signal remain live for the next pass.
          if (
            current.active &&
            !current.eventDone &&
            ray.status === PREVIEW_EXHAUSTED
          ) {
            // Deliberately empty.
          }
          if (
            !current.active &&
            current.termination === "noIntersection" &&
            !current.terminalApplied
          ) {
            current.color = terminal(current, ray.py);
            current.terminalApplied = true;
          }
          return current.color;
        },
      },
      size,
      outputRegion,
    );
    totalSteps += panel.steps;
    totalEvals += panel.evals;
    totalMs += panel.ms;
    if (![...states.values()].some((state) => state.active)) break;
  }
  for (const state of states.values()) {
    if (state.active) {
      state.active = false;
      mark(state, "chunkCap");
    }
    work.worstRay = Math.max(work.worstRay, state.work);
  }
  const rows = [...states.values()];
  const stats: PanelStats = {
    ...panel!,
    hits: rows.filter((state) => state.variation > 0).length,
    steps: totalSteps,
    evals: totalEvals,
    ms: totalMs,
    exhausted: termination.unresolved,
  };
  const lateral = rows.map(
    (state) => length(state.fullDelta?.delta ?? [0, 0, 0]) / R,
  );
  return {
    stats,
    calls,
    unresolved: termination.unresolved,
    rearHits: rows.filter((state) => state.rear).length,
    frontThenGuard: rows.filter((state) => state.frontThenGuard).length,
    attributionCounts,
    rearMask: Uint8Array.from(pixels, (state) => Number(state.rear)),
    frontThenGuardMask: Uint8Array.from(pixels, (state) =>
      Number(state.frontThenGuard),
    ),
    bendMask: Uint8Array.from(pixels, (state) =>
      Number(
        state.bendStrength > 0 &&
          length(state.fullDelta?.delta ?? [0, 0, 0]) > 0,
      ),
    ),
    variation: Float64Array.from(pixels, (state) => state.variation),
    bendStrength: Float64Array.from(pixels, (state) => state.bendStrength),
    throughput: Float64Array.from(pixels, (state) => state.throughput),
    eventCounts: Uint16Array.from(pixels, (state) => state.events),
    sampleCounts: Uint32Array.from(pixels, (state) => state.samples),
    work,
    termination,
    bending: {
      onset,
      bentPixels: rows.filter(
        (state) =>
          state.bendStrength > 0 &&
          length(state.fullDelta?.delta ?? [0, 0, 0]) > 0,
      ).length,
      reversalStops: rows.filter((state) => state.reversalStop).length,
      offsetLimitedPixels: rows.filter((state) => state.fullDelta?.limited)
        .length,
      maximumLateralFraction: Math.max(0, ...lateral),
      meanStrength:
        rows.reduce((sum, state) => sum + state.bendStrength, 0) / rows.length,
      convention:
        onset === "weighted"
          ? "one fixed first-approach lateral delta accumulates positive increments; first reversal or strength 1 permanently stops steering"
          : onset === "hard"
            ? "full smoothly bounded lateral shift at the first sampled positive increment"
            : "straight world ray; no lateral displacement",
    },
    sampling: {
      deltaFraction: CLEARANCE_BAND_CONTRACT.sampleRadiusFraction,
      chunkSteps,
      maxSamples,
      maxChunks,
      shiftedDomainPolicy:
        "retain original entry+lattice index; shifted-pre-entry slots set signal=0 without a DE query",
    },
  };
}
