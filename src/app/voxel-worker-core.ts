/**
 * The solid render's Web Worker session state machine (fr-v4f): bounds
 * estimation, voxel-grid accumulation in adaptive chunks, the proactive +
 * reactive OOM guard, and throttled RGBA8 texture packing — all off the main
 * thread. `voxel-worker.ts` is the thin `self.onmessage`/`postMessage` glue
 * that wires a {@link VoxelWorkerSession} to the real worker globals; this
 * module touches none of them directly (no `self`, `postMessage`,
 * `performance`, `setTimeout`), which is what makes it plain-Vitest testable
 * with an injected {@link VoxelWorkerDeps} — the exact structure of
 * `flame-worker-core.ts`, for the exact same reasons (see that module's doc,
 * including why transport is postMessage TRANSFER, not SharedArrayBuffer).
 *
 * Unlike the flame session there are no live tone-map commands: everything
 * visual downstream of the grid (isosurface threshold, light direction,
 * ambient) is a GPU uniform the main thread changes without touching the
 * worker. Only the iteration budget is live here.
 */
import {
  accumulateVoxels,
  clampVoxelResolution,
  computeVoxelBounds,
  createVoxelGrid,
  voxelTextureData,
} from "../fractal/voxel";
import type { VoxelBounds, VoxelGrid } from "../fractal/voxel";
import { prepareChaosGame } from "../fractal/chaos-game";
import type { PreparedChaosGame } from "../fractal/chaos-game";
import { transformColors } from "../fractal/color";
import { mulberry32 } from "../fractal/rng";
import type { Rng } from "../fractal/rng";
import type { ColorMode, Transform, Vec3 } from "../fractal/types";

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

/** Main thread → worker. */
export type VoxelWorkerCommand =
  | {
      type: "start";
      transforms: Transform[];
      finalTransform: Transform | null;
      /** Requested voxels per axis; the session clamps to its memory budget. */
      resolution: number;
      /** The explorer's active color mode, carried into the voxel colors
       * (fr-c1d) — see `accumulateVoxels`' coloring doc. */
      colorMode: ColorMode;
      iterationsBudget: number;
      /** Explicit numeric seed (not a live `Rng`, which can't cross
       * postMessage) — also makes a render a reproducible pure function of
       * its inputs. */
      seed: number;
    }
  | { type: "setIterationsBudget"; iterations: number };

/** Worker → main thread. */
export type VoxelWorkerEvent =
  | {
      type: "grid";
      /** RGBA8 3D-texture bytes (see `voxelTextureData`), transferred (zero-copy). */
      texture: Uint8Array<ArrayBuffer>;
      /** Voxels per axis of `texture` — the EFFECTIVE (post-clamp) resolution. */
      size: number;
      boundsMin: Vec3;
      boundsMax: Vec3;
      iterationsDone: number;
      iterationsBudget: number;
    }
  | {
      type: "resolutionNote";
      /** Maps onto `Ui.setSolidResolutionNote`'s signature, mirroring the
       * flame's supersampleNote: `null` = running at the requested value. */
      effective: number | null;
      requested?: number;
    }
  | {
      /** Counters-only label refresh for when the budget changes but the
       * displayed texture is already final (see `setIterationsBudget` in
       * {@link VoxelWorkerSession.handle}) — re-packing and re-transferring
       * the whole O(size³) volume just to update a label would be far too
       * heavy for a slider drag. */
      type: "progress";
      iterationsDone: number;
      iterationsBudget: number;
    }
  | { type: "error"; message: string };

/**
 * Environment the session runs in, injected so the state machine has no
 * direct dependency on worker globals (testable) and so a test can simulate
 * an OOM deterministically instead of actually exhausting memory — the same
 * shape as `FlameWorkerDeps`.
 */
export interface VoxelWorkerDeps {
  /** Wall-clock time source (`performance.now()` in the real worker). */
  now: () => number;
  /** Schedules `fn` to run, yielding first — `(fn) => setTimeout(fn, 0)` in
   * the real worker — so a command can be handled between chunks. */
  schedule: (fn: () => void) => void;
  /** Delivers one event to the main thread (`postMessage` in the real worker). */
  emit: (event: VoxelWorkerEvent) => void;
  /** Defaults to the real {@link createVoxelGrid}; overridable so a test can
   * force the OOM-retry path without a real allocation failure. */
  createGrid?: typeof createVoxelGrid;
  /** Defaults to the real (320 MiB-derived) voxel budget; overridable so a
   * test can trigger the proactive `clampVoxelResolution` guard cheaply. */
  maxVoxels?: number;
  /** Defaults to the real (1,000,000) initial chunk size; overridable so a
   * test can force a multi-chunk render with a tiny iteration budget. */
  initialChunkSize?: number;
  /** Defaults to the real bounds-pass sample count; overridable so tests run
   * the pilot orbit in microseconds. */
  boundsSamples?: number;
}

// ---------------------------------------------------------------------------
// Tuning constants — chunking mirrors flame-worker-core's (relocated
// reasoning, not retuned; see that module); the texture cadence is its own.
// ---------------------------------------------------------------------------

const VOXEL_CHUNK_INITIAL = 1_000_000;
const VOXEL_CHUNK_MIN = 100_000;
const VOXEL_CHUNK_MAX = 20_000_000;
/** Target wall-clock time per accumulation chunk — keeps chunks short enough
 * that a `setIterationsBudget` command is picked up promptly. */
const VOXEL_FRAME_BUDGET_MS = 8;

/**
 * Minimum time between texture pack + transfer refreshes while actively
 * accumulating. Packing is a full O(size^3) pass over the grid (tens of ms
 * at 192^3) and the transfer reallocates the whole RGBA8 buffer, so it runs
 * on a throttle — a stride, not per chunk — while accumulation itself runs
 * every scheduled chunk. Longer than the flame's 150 ms because the packed
 * volume is an order of magnitude more bytes than a display-size image.
 */
const VOXEL_TEXTURE_INTERVAL_MS = 250;

/** Bytes per voxel across everything a session allocates per voxel: Float32
 * density (4) + Float32 RGB running mean (12) + the RGBA8 texture (4). */
const BYTES_PER_VOXEL = 20;
/**
 * Memory ceiling for one session's grid + texture. 320 MiB / 20 bytes is
 * exactly 256^3 voxels — the slider's own maximum passes untouched on
 * desktop while the same proactive guard the flame uses protects
 * memory-constrained phones (backed up by the reactive shrink in `start`).
 */
const MAX_VOXEL_ACCUM_BYTES = 320 * 1024 * 1024;
const MAX_VOXELS = Math.floor(MAX_VOXEL_ACCUM_BYTES / BYTES_PER_VOXEL);

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * One solid render's worker-side session: owns the voxel grid, the OOM
 * guard, and the throttled texture packing. One instance per worker; the
 * main thread gets a fresh session by terminating the worker and spinning up
 * a new one (see `main.ts`), so — like the flame session — there is no
 * `cancel` command: `Worker.terminate()` is the only thing that actually
 * stops an in-flight chunk.
 */
export class VoxelWorkerSession {
  private readonly now: () => number;
  private readonly schedule: (fn: () => void) => void;
  private readonly emit: (event: VoxelWorkerEvent) => void;
  private readonly createGrid: typeof createVoxelGrid;
  private readonly maxVoxels: number;
  private readonly initialChunkSize: number;
  private readonly boundsSamples: number | undefined;

  private prepared: PreparedChaosGame | null = null;
  private palette: ReturnType<typeof transformColors> = [];
  private rng: Rng = Math.random;
  private colorMode: ColorMode = "transform";
  private grid: VoxelGrid | null = null;
  private bounds: VoxelBounds | null = null;

  /** The effective (post-budget-clamp) resolution the grid was created at. */
  private effectiveResolution = 0;
  /** Ratchets DOWN (never up) when a grid allocation actually fails at some
   * size — learned once per session, exactly like the flame session's
   * `maxSafeSupersample` (see its doc for why never up). */
  private maxSafeResolution = Infinity;
  private requestedResolution = 0;

  private iterationsDone = 0;
  private iterationsBudget = 0;

  /** undefined until the first texture pack of this session, so that first
   * one is never throttled. */
  private lastTextureAt: number | undefined;
  private chunkSize: number;
  /** True while a chunk is scheduled or in flight — guards against
   * double-scheduling the loop. */
  private running = false;

  constructor(deps: VoxelWorkerDeps) {
    this.now = deps.now;
    this.schedule = deps.schedule;
    this.emit = deps.emit;
    this.createGrid = deps.createGrid ?? createVoxelGrid;
    this.maxVoxels = deps.maxVoxels ?? MAX_VOXELS;
    this.initialChunkSize = deps.initialChunkSize ?? VOXEL_CHUNK_INITIAL;
    this.boundsSamples = deps.boundsSamples;
    this.chunkSize = this.initialChunkSize;
  }

  /** Dispatch one command from the main thread. */
  handle(command: VoxelWorkerCommand): void {
    switch (command.type) {
      case "start":
        this.start(command);
        break;
      case "setIterationsBudget": {
        const wasFinished = this.iterationsDone >= this.iterationsBudget;
        this.iterationsBudget = command.iterations;
        if (this.iterationsDone < this.iterationsBudget) {
          this.ensureRunning(); // resume if this raised the budget past iterationsDone.
        } else if (wasFinished) {
          // Already finished before this change, so the displayed texture is
          // already final — only the label's target is now stale (fr-15z).
          // Send just the counters; see the `progress` event's doc for why
          // not the (heavy) full grid.
          this.emit({
            type: "progress",
            iterationsDone: this.iterationsDone,
            iterationsBudget: this.iterationsBudget,
          });
        } else if (this.grid) {
          // Lowered to/below the accumulated count mid-render: that finishes
          // the render on the spot, but no chunk will run to say so — the
          // already-scheduled one bails silently in runChunk — so the label
          // would freeze at its last value (fr-15z) and the display would
          // miss whatever accumulated since the last throttled pack. Send
          // the final grid (fresh counters included) here.
          this.sendGrid(this.grid);
        }
        break;
      }
    }
  }

  private start(cmd: Extract<VoxelWorkerCommand, { type: "start" }>): void {
    this.prepared = prepareChaosGame(cmd.transforms, cmd.finalTransform);
    this.palette = transformColors(cmd.transforms.length);
    this.rng = mulberry32(cmd.seed);
    this.colorMode = cmd.colorMode;
    this.iterationsBudget = cmd.iterationsBudget;
    this.requestedResolution = cmd.resolution;
    this.maxSafeResolution = Infinity; // a fresh session has no learned ceiling yet.
    // The bounds pilot is part of the same seeded run, so a given seed
    // produces one reproducible render, bounds included.
    this.bounds = computeVoxelBounds(
      this.prepared,
      this.rng,
      this.boundsSamples,
    );
    this.startAccumulation();
  }

  /**
   * (Re)allocate the grid at the largest resolution the budget (and any
   * learned allocation ceiling) allows, and start accumulating. On a real
   * allocation failure, learn the ceiling and retry one step smaller rather
   * than failing every attempt forever — the reactive guard backing up the
   * proactive `clampVoxelResolution` estimate, mirroring the flame session's
   * supersample fallback.
   */
  private startAccumulation(): void {
    if (!this.bounds) return;
    const effective = Math.min(
      clampVoxelResolution(this.requestedResolution, this.maxVoxels),
      this.maxSafeResolution,
    );
    try {
      this.grid = this.createGrid(effective, this.bounds);
    } catch (e) {
      if (effective > 32) {
        this.maxSafeResolution = effective - 32;
        this.startAccumulation();
      } else {
        // Nothing smaller left to fall back to — surface it; the main
        // thread returns to the explorer rather than retrying forever.
        this.emit({ type: "error", message: describeError(e) });
      }
      return;
    }
    this.effectiveResolution = effective;
    this.iterationsDone = 0;
    this.lastTextureAt = undefined;
    this.chunkSize = this.initialChunkSize;
    this.emit({
      type: "resolutionNote",
      effective: effective < this.requestedResolution ? effective : null,
      requested: this.requestedResolution,
    });
    this.ensureRunning();
  }

  private ensureRunning(): void {
    if (this.running) return;
    if (!this.prepared || !this.grid) return;
    if (this.iterationsDone >= this.iterationsBudget) return;
    this.running = true;
    this.schedule(() => this.runChunk());
  }

  private runChunk(): void {
    const prepared = this.prepared;
    const grid = this.grid;
    // Re-checked here, not just in ensureRunning's gate: a budget LOWERED
    // below iterationsDone between scheduling and firing must stop here, or
    // the chunk math below goes negative (see flame-worker-core's runChunk).
    if (!prepared || !grid || this.iterationsDone >= this.iterationsBudget) {
      this.running = false;
      return;
    }

    const chunk = Math.min(
      this.chunkSize,
      this.iterationsBudget - this.iterationsDone,
    );
    const t0 = this.now();
    accumulateVoxels(
      prepared,
      grid,
      chunk,
      this.rng,
      this.palette,
      this.colorMode,
    );
    const t1 = this.now();
    this.iterationsDone += chunk;
    this.adaptChunkSize(t1 - t0);

    const finished = this.iterationsDone >= this.iterationsBudget;
    const due =
      finished ||
      this.lastTextureAt === undefined ||
      t1 - this.lastTextureAt >= VOXEL_TEXTURE_INTERVAL_MS;
    if (due) {
      this.lastTextureAt = t1;
      if (!this.sendGrid(grid)) {
        this.running = false;
        return;
      }
    }

    if (finished) {
      this.running = false;
    } else {
      this.schedule(() => this.runChunk());
    }
  }

  /**
   * Pack `grid` and send it with the current progress counters; returns
   * false (after emitting an error) if the pack fails. Packing allocates the
   * full RGBA8 volume; a failure here (unlike the grid allocation in
   * `startAccumulation`) has accumulated progress worth keeping, but no way
   * to display it — surface it rather than looping.
   */
  private sendGrid(grid: VoxelGrid): boolean {
    let texture: Uint8Array<ArrayBuffer>;
    try {
      texture = voxelTextureData(grid);
    } catch (e) {
      this.emit({ type: "error", message: describeError(e) });
      return false;
    }
    this.emit({
      type: "grid",
      texture,
      size: this.effectiveResolution,
      boundsMin: grid.bounds.min,
      boundsMax: grid.bounds.max,
      iterationsDone: this.iterationsDone,
      iterationsBudget: this.iterationsBudget,
    });
    return true;
  }

  private adaptChunkSize(elapsed: number): void {
    if (elapsed <= 0) return;
    // Damped multiplicative correction (capped to 0.5x-2x per chunk) so one
    // slow chunk (e.g. a GC pause) doesn't overcorrect wildly.
    const scale = Math.min(2, Math.max(0.5, VOXEL_FRAME_BUDGET_MS / elapsed));
    this.chunkSize = Math.round(
      Math.min(
        VOXEL_CHUNK_MAX,
        Math.max(VOXEL_CHUNK_MIN, this.chunkSize * scale),
      ),
    );
  }
}
