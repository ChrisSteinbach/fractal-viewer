/**
 * Shared, deliberately small contract for the transmission feasibility
 * pilots. It describes sampled clearance bands, not an inside test: a ray
 * gets one event when a DE sample crosses into `enter`, remains in that run
 * until a sample exceeds `leave`, and completes only after its analytic
 * bounding-sphere interval has been consumed.
 *
 * This file is imported by the CPU experiment and the browser GPU pilot so a
 * comparison means the same positions and the same event definition. The
 * coordinates use only ordinary JS numbers; callers upload them as f32 and
 * record that conversion in their report.
 */

export const CLEARANCE_BAND_CONTRACT = Object.freeze({
  enterRadiusFraction: 0.002,
  leaveRadiusFraction: 0.003,
  sampleRadiusFraction: 0.001,
  throughput: 0.9,
  description:
    "fixed world-space samples through the full raw bounding ball; DE<=enter starts a run and DE>leave leaves it",
});

/** Qualification must fail closed on an unfinished raster or a changed
 * trace, even when the sampled CPU/GPU point witnesses happen to agree. */
export function clearancePilotRefusal(report: {
  rows: readonly {
    result: { unresolved: number };
    cpuAgreement: { verdict: string };
  }[];
  chunkInvariant: readonly { complete: boolean; samePerRayTrace: boolean }[];
}): string | null {
  if (report.rows.length === 0) return "no completed fixture evidence";
  if (report.rows.some((row) => row.result.unresolved !== 0))
    return "unfinished sampled-domain rays";
  if (report.rows.some((row) => row.cpuAgreement.verdict !== "pass"))
    return "CPU/GPU event predicate agreement did not pass";
  if (
    report.chunkInvariant.some((row) => !row.complete || !row.samePerRayTrace)
  )
    return "work-chunk trace invariance did not pass";
  return null;
}

export const CONTINUATION_STATE_BYTES = Object.freeze({
  /** next sample, ray status, event count and sampled-tail completion. */
  control: 16,
  /** origin/entry-t and direction/exit-t; retained across submissions. */
  ray: 32,
  /** fixed attenuation plus the current run flag. */
  throughput: 16,
  /** Fixed record alone; compact scheduling buffers live separately. */
  core: 64,
  /** compact active-list word; status readback is another word. */
  scheduling: 8,
  total: 72,
});

export type ClearanceRay = {
  x: number;
  y: number;
  origin: readonly [number, number, number];
  direction: readonly [number, number, number];
  enter: number;
  exit: number;
  samples: number;
};

export type ClearanceRayGrid = {
  width: number;
  height: number;
  radius: number;
  delta: number;
  fovY: number;
  rays: ClearanceRay[];
};

export type ClearanceTraceState = {
  sample: number;
  insideRun: boolean;
  events: number;
  complete: boolean;
  unresolved: boolean;
};

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/**
 * A deterministic pinhole grid and analytic half-open full-ball interval:
 * `enter + k*delta < exit`. Rays that miss or only touch the ball have
 * `samples: 0`; this is an analytic-domain miss, unrelated to a DE result.
 * The grid is the public coordinate interface between the CPU and GPU pilots.
 */
export function makeClearanceRayGrid({
  width,
  height,
  radius,
  fovY = Math.PI / 3,
}: {
  width: number;
  height: number;
  radius: number;
  fovY?: number;
}): ClearanceRayGrid {
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    throw new Error("clearance grid needs positive integer width and height");
  }
  if (!(radius > 0) || !Number.isFinite(radius)) {
    throw new Error("clearance grid needs a finite positive raw radius");
  }
  const origin: [number, number, number] = [0, 0, radius * 2.5];
  const tanHalf = Math.tan(fovY / 2);
  const aspect = width / height;
  const delta = radius * CLEARANCE_BAND_CONTRACT.sampleRadiusFraction;
  const rays = new Array<ClearanceRay>(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = ((x + 0.5) / width) * 2 - 1;
      const ny = 1 - ((y + 0.5) / height) * 2;
      const direction = normalize(nx * tanHalf * aspect, ny * tanHalf, -1);
      const b = origin[2] * direction[2];
      const discriminant = b * b - (origin[2] * origin[2] - radius * radius);
      let enter = 0;
      let exit = 0;
      let samples = 0;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        enter = -b - root;
        exit = -b + root;
        // The camera is outside in this contract, but keeping this explicit
        // makes a future pose change loud rather than sampling behind it.
        if (exit > 0) {
          enter = Math.max(0, enter);
          // Half-open t < exit, matching de-preview's fixed-grid loop. In
          // particular, a tangent has zero samples and an exact multiple of
          // delta never gains an endpoint sample.
          samples = Math.ceil((exit - enter) / delta);
        }
      }
      rays[y * width + x] = {
        x,
        y,
        origin,
        direction,
        enter,
        exit,
        samples,
      };
    }
  }
  return { width, height, radius, delta, fovY, rays };
}

export function clearanceSamplePoint(
  ray: ClearanceRay,
  sampleIndex: number,
  delta: number,
): [number, number, number] {
  if (
    !Number.isInteger(sampleIndex) ||
    sampleIndex < 0 ||
    sampleIndex >= ray.samples
  ) {
    throw new Error(
      "clearance sample index is outside this ray's analytic interval",
    );
  }
  const t = Math.min(ray.exit, ray.enter + sampleIndex * delta);
  return [
    ray.origin[0] + ray.direction[0] * t,
    ray.origin[1] + ray.direction[1] * t,
    ray.origin[2] + ray.direction[2] * t,
  ];
}

export function makeClearanceTraceState(
  grid: ClearanceRayGrid,
): ClearanceTraceState[] {
  return grid.rays.map((ray) => ({
    sample: 0,
    insideRun: false,
    events: 0,
    complete: ray.samples === 0,
    unresolved: false,
  }));
}

/** Apply one DE sample without inventing an interior classification. */
export function applyClearanceSample(
  state: ClearanceTraceState,
  distance: number,
  radius: number,
): void {
  const enter = radius * CLEARANCE_BAND_CONTRACT.enterRadiusFraction;
  const leave = radius * CLEARANCE_BAND_CONTRACT.leaveRadiusFraction;
  if (!Number.isFinite(distance)) {
    state.unresolved = true;
    return;
  }
  if (!state.insideRun && distance <= enter) {
    state.insideRun = true;
    state.events++;
  } else if (state.insideRun && distance > leave) {
    state.insideRun = false;
  }
}

export function traceStateSummary(state: readonly ClearanceTraceState[]): {
  sampledDomainComplete: number;
  unresolved: number;
  events: number;
  eventRays: number;
  perEventThroughput: number;
} {
  let sampledDomainComplete = 0;
  let unresolved = 0;
  let events = 0;
  let eventRays = 0;
  for (const ray of state) {
    if (ray.complete && !ray.unresolved) sampledDomainComplete++;
    if (ray.unresolved || !ray.complete) unresolved++;
    events += ray.events;
    if (ray.events > 0) eventRays++;
  }
  return {
    sampledDomainComplete,
    unresolved,
    events,
    eventRays,
    // This pilot does no appearance compositing. The model's normal-free
    // throughput is fixed for every event; callers apply it per ray, never
    // once to this frame-wide aggregate.
    perEventThroughput: CLEARANCE_BAND_CONTRACT.throughput,
  };
}
