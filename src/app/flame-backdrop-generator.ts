/**
 * The asynchronous, low-budget flame render used as a scene backdrop.
 *
 * Requests are trailing-edge debounced and latest-wins, with at most one
 * worker render in flight and one newer snapshot parked behind it. The worker
 * is lazy and persistent: successive renders are new `start` commands on the
 * same flame-worker session, while a construction/runtime failure drops only
 * the failed work and lets a later request try a fresh worker. There is
 * deliberately no synchronous fallback — a decorative backdrop must never
 * make the interactive explorer wait for a million-iteration flame render.
 *
 * `suspend()` is the morph hold. It keeps the last delivered image in its
 * owner's hands, suppresses the current render if it finishes, and parks only
 * the latest requested snapshot until `resume()` restarts the debounce. If no
 * newer snapshot was requested, the interrupted snapshot itself is parked for
 * one clean rerender after the hold.
 */
import { resolveBackground } from "./background";
import type { FlameWorkerCommand, FlameWorkerEvent } from "./flame-worker-core";

type FlameStartCommand = Extract<FlameWorkerCommand, { type: "start" }>;

/** The complete dimensional/render snapshot whose authored values can vary.
 * The low-budget tone-map, blur, supersample and CPU settings stay private to
 * this generator so call sites cannot accidentally turn the backdrop into a
 * full flame render. */
export type FlameBackdropParams = Pick<
  FlameStartCommand,
  | "transforms"
  | "finalTransform"
  | "projection"
  | "width"
  | "height"
  | "seed"
  | "palette"
  | "order"
  | "plane"
  | "twist"
  | "fourD"
>;

/** One immutable, top-origin RGBA backdrop. Structurally compatible with
 * `TraceBackgroundImage`; `meanRgb` is the normalized mean of the FINAL,
 * opaque composited bytes and lets a renderer choose a cheap representative
 * color without reading the image again. */
export interface FlameBackdropImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
  readonly revision: number;
  readonly meanRgb: readonly [red: number, green: number, blue: number];
}

/** The generator's deliberately tiny handle on the existing flame worker. */
export interface FlameBackdropWorkerHandle {
  post(command: FlameWorkerCommand): void;
  /** Implementations detach listeners before terminating, so queued events
   * cannot leak across lazy worker recreation. The generator also generation-
   * stamps its callbacks as a second guard. */
  terminate(): void;
}

export interface FlameBackdropGeneratorDeps {
  /** Lazily creates the worker and wires its existing protocol callbacks. */
  createWorker: (
    onEvent: (event: FlameWorkerEvent) => void,
    onError: (error: unknown) => void,
  ) => FlameBackdropWorkerHandle | null;
  /** Publishes only a terminal image that was still current at arrival. */
  onImage: (image: FlameBackdropImage) => void;
  /** Optional diagnostics; errors never clear or replace the last image. */
  onError?: (error: unknown) => void;
  /** Injected trailing-edge timer. The real default is setTimeout/clearTimeout. */
  schedule?: (fn: () => void, delayMs: number) => () => void;
}

/** Fixed cheap-render policy. The equal estimator radii make the final
 * density-estimation pass a broad, deliberately out-of-focus blur. */
export const FLAME_BACKDROP_DEBOUNCE_MS = 300;
export const FLAME_BACKDROP_ITERATIONS = 1_000_000;
const FLAME_BACKDROP_SUPERSAMPLE = 1;
const FLAME_BACKDROP_EXPOSURE = 0.2;
const FLAME_BACKDROP_GAMMA = 2.4;
const FLAME_BACKDROP_VIBRANCY = 1;
const FLAME_BACKDROP_BLUR_RADIUS = 4;
const FLAME_BACKDROP_ESTIMATOR_CURVE = 0.4;

interface BackdropJob {
  readonly revision: number;
  readonly params: FlameBackdropParams;
  /** False only for work that crossed a suspend boundary. */
  acceptable: boolean;
  /** The debounce has elapsed; dispatch as soon as the worker is idle. */
  ready: boolean;
}

function defaultSchedule(fn: () => void, delayMs: number): () => void {
  const timer = setTimeout(fn, delayMs);
  return () => clearTimeout(timer);
}

/** Build the existing flame worker's start payload with every expensive knob
 * pinned to the backdrop budget. Omitting `sharedFrames` forces the transfer-
 * mode terminal RGBA event consumed below. */
function startCommand(params: FlameBackdropParams): FlameStartCommand {
  return {
    type: "start",
    ...params,
    requestedSupersample: FLAME_BACKDROP_SUPERSAMPLE,
    iterationsBudget: FLAME_BACKDROP_ITERATIONS,
    exposure: FLAME_BACKDROP_EXPOSURE,
    gamma: FLAME_BACKDROP_GAMMA,
    vibrancy: FLAME_BACKDROP_VIBRANCY,
    estimatorRadius: FLAME_BACKDROP_BLUR_RADIUS,
    estimatorMinimumRadius: FLAME_BACKDROP_BLUR_RADIUS,
    estimatorCurve: FLAME_BACKDROP_ESTIMATOR_CURVE,
    gpuPreference: "off",
  };
}

/** Screen the flame over the built-in dark vertical gradient. The worker's
 * input buffer is never mutated: transferred storage may still be observed by
 * a host/fake, and a newly-owned array makes the image's immutability contract
 * explicit. */
export function compositeFlameBackdrop(
  source: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  revision: number,
): FlameBackdropImage {
  const expectedLength = width * height * 4;
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0 ||
    source.length !== expectedLength
  ) {
    throw new Error("Invalid flame backdrop image dimensions");
  }

  const { top, bottom } = resolveBackground({ mode: "dark" });
  const rgba = new Uint8ClampedArray(expectedLength);
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;

  for (let y = 0; y < height; y++) {
    // Match the app's full-image gradient convention: sample at the pixel
    // centre, with row zero at the authored top stop.
    const t = (y + 0.5) / height;
    const bgRed = top[0] + (bottom[0] - top[0]) * t;
    const bgGreen = top[1] + (bottom[1] - top[1]) * t;
    const bgBlue = top[2] + (bottom[2] - top[2]) * t;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const flameRed = source[offset] / 255;
      const flameGreen = source[offset + 1] / 255;
      const flameBlue = source[offset + 2] / 255;
      const red = Math.round((flameRed + bgRed * (1 - flameRed)) * 255);
      const green = Math.round((flameGreen + bgGreen * (1 - flameGreen)) * 255);
      const blue = Math.round((flameBlue + bgBlue * (1 - flameBlue)) * 255);
      rgba[offset] = red;
      rgba[offset + 1] = green;
      rgba[offset + 2] = blue;
      rgba[offset + 3] = 255;
      redSum += red;
      greenSum += green;
      blueSum += blue;
    }
  }

  const meanDenominator = width * height * 255;
  return {
    width,
    height,
    rgba,
    revision,
    meanRgb: [
      redSum / meanDenominator,
      greenSum / meanDenominator,
      blueSum / meanDenominator,
    ],
  };
}

/** Latest-wins controller for the optional generated backdrop. */
export class FlameBackdropGenerator {
  private readonly schedule: (fn: () => void, delayMs: number) => () => void;
  private worker: FlameBackdropWorkerHandle | null = null;
  /** Callback generation for rejecting queued events from a dead worker. */
  private workerGeneration = 0;
  private nextRevision = 1;
  private inFlight: BackdropJob | null = null;
  private pending: BackdropJob | null = null;
  private cancelDebounce: (() => void) | null = null;
  private suspended = false;
  private destroyed = false;
  private settledResolvers: (() => void)[] = [];

  constructor(private readonly deps: FlameBackdropGeneratorDeps) {
    this.schedule = deps.schedule ?? defaultSchedule;
  }

  /** Replace the parked snapshot and restart its trailing-edge debounce. */
  request(params: FlameBackdropParams): void {
    if (this.destroyed) return;
    this.pending = {
      revision: this.nextRevision++,
      params,
      acceptable: true,
      ready: false,
    };
    this.cancelPendingDebounce();
    if (!this.suspended) this.armDebounce();
  }

  /** Hold the last published image across a morph. Work already in flight is
   * allowed to finish off-thread but can never publish across this boundary;
   * its snapshot is retained only when no newer pending snapshot exists. */
  suspend(): void {
    if (this.destroyed || this.suspended) return;
    this.suspended = true;
    this.cancelPendingDebounce();
    if (this.inFlight !== null) {
      this.inFlight.acceptable = false;
      if (this.pending === null) {
        this.pending = {
          revision: this.inFlight.revision,
          params: this.inFlight.params,
          acceptable: true,
          ready: false,
        };
      }
    }
    this.flushSettled();
  }

  /** Leave the morph hold and debounce the latest parked snapshot afresh. */
  resume(): void {
    if (this.destroyed || !this.suspended) return;
    this.suspended = false;
    if (this.pending !== null) this.armDebounce();
  }

  /** Resolve after the debounce/pending/in-flight pipeline drains. A snapshot
   * deliberately parked by `suspend()` does not keep callers waiting, though
   * already-running worker work still does until its terminal event/error. */
  settle(): Promise<void> {
    if (this.isSettled()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.settledResolvers.push(resolve);
    });
  }

  /** Permanently stop this controller. Late callbacks are generation-stale,
   * all parked work is discarded, and every settle waiter is released. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelPendingDebounce();
    this.pending = null;
    this.inFlight = null;
    this.workerGeneration++;
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
    this.flushSettled();
  }

  private armDebounce(): void {
    const job = this.pending;
    if (job === null || this.suspended || this.destroyed) return;
    this.cancelPendingDebounce();
    this.cancelDebounce = this.schedule(() => {
      this.cancelDebounce = null;
      if (this.destroyed || this.suspended || this.pending !== job) {
        this.flushSettled();
        return;
      }
      job.ready = true;
      this.dispatchPending();
      this.flushSettled();
    }, FLAME_BACKDROP_DEBOUNCE_MS);
  }

  private cancelPendingDebounce(): void {
    const cancel = this.cancelDebounce;
    this.cancelDebounce = null;
    cancel?.();
  }

  private dispatchPending(): void {
    const job = this.pending;
    if (
      job === null ||
      !job.ready ||
      this.inFlight !== null ||
      this.suspended ||
      this.destroyed
    ) {
      return;
    }

    // Assign before post: even a synchronous fake callback sees the request
    // as in flight and cannot be mistaken for a stray event.
    this.pending = null;
    this.inFlight = job;
    if (this.worker === null) this.worker = this.spawnWorker();
    if (this.worker === null) {
      this.inFlight = null;
      this.flushSettled();
      return;
    }

    try {
      this.worker.post(startCommand(job.params));
    } catch (error) {
      this.handleWorkerFailure(this.workerGeneration, error);
    }
  }

  private spawnWorker(): FlameBackdropWorkerHandle | null {
    const generation = ++this.workerGeneration;
    let worker: FlameBackdropWorkerHandle | null;
    try {
      worker = this.deps.createWorker(
        (event) => this.handleEvent(generation, event),
        (error) => this.handleWorkerFailure(generation, error),
      );
    } catch (error) {
      this.deps.onError?.(error);
      return null;
    }
    if (worker === null) {
      this.deps.onError?.(new Error("Flame backdrop worker unavailable"));
      return null;
    }
    // A pathological synchronous error callback can invalidate this factory
    // before it returns. Do not install that already-dead handle.
    if (this.destroyed || generation !== this.workerGeneration) {
      worker.terminate();
      return null;
    }
    return worker;
  }

  private handleEvent(generation: number, event: FlameWorkerEvent): void {
    if (this.destroyed || generation !== this.workerGeneration) return;
    if (event.type === "error") {
      this.handleWorkerFailure(generation, new Error(event.message));
      return;
    }
    if (
      event.type !== "progress" ||
      event.iterationsDone < event.iterationsBudget
    ) {
      return;
    }

    const job = this.inFlight;
    if (job === null) return;
    this.inFlight = null;

    // A pending request, even one whose debounce has not elapsed yet, makes
    // this terminal image stale. Dispatch a ready successor before the image
    // callback so the worker starts again while the host uploads pixels.
    const current =
      job.acceptable &&
      !this.suspended &&
      this.pending === null &&
      job.revision === this.nextRevision - 1;
    this.dispatchPending();

    if (current) {
      let image: FlameBackdropImage;
      try {
        image = compositeFlameBackdrop(
          event.image,
          event.width,
          event.height,
          job.revision,
        );
      } catch (error) {
        this.handleWorkerFailure(generation, error);
        return;
      }
      this.deps.onImage(image);
    }
    this.flushSettled();
  }

  private handleWorkerFailure(generation: number, error: unknown): void {
    if (this.destroyed || generation !== this.workerGeneration) return;
    this.workerGeneration++;
    const worker = this.worker;
    this.worker = null;
    this.inFlight = null;
    worker?.terminate();
    this.deps.onError?.(error);
    // A genuinely newer parked request may still deserve a fresh worker. A
    // failed request itself is never retried inline; the next request lazily
    // recreates the worker and the last published image remains untouched.
    this.dispatchPending();
    this.flushSettled();
  }

  private isSettled(): boolean {
    return (
      this.inFlight === null &&
      this.cancelDebounce === null &&
      (this.pending === null || this.suspended)
    );
  }

  private flushSettled(): void {
    if (!this.isSettled()) return;
    const resolvers = this.settledResolvers;
    this.settledResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}
