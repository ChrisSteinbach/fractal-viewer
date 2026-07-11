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
 * worker. Only the iteration budget, the palette (fr-1kt — restarts
 * accumulation the same way, since baked-in colors can't be reapplied live),
 * and the symmetry (fr-6im — it reshapes the geometry itself, not a
 * tone-map param, so it restarts accumulation like the flame session's
 * `setSymmetry`) are live here.
 */
import {
  accumulateVoxels,
  clampVoxelResolution,
  computeVoxelBounds,
  createVoxelGrid,
  voxelTextureData,
} from "../fractal/voxel";
import type { VoxelBounds, VoxelGrid } from "../fractal/voxel";
import { accumulateVoxels4, computeVoxelBounds4 } from "../fractal/voxel-4d";
import { prepareChaosGame } from "../fractal/chaos-game";
import type { PreparedChaosGame } from "../fractal/chaos-game";
import { prepareChaosGame4 } from "../fractal/chaos-game-4d";
import type { PreparedChaosGame4 } from "../fractal/chaos-game-4d";
import {
  buildColorModeLUT,
  transformColors,
  W_SIDE_PALETTES,
} from "../fractal/color";
import type { FourDRenderColor, PositionAxisColors } from "../fractal/color";
import { composeRotorProjection4 } from "../fractal/project4";
import type { FourDView, RotorProjection4 } from "../fractal/project4";
import { buildPaletteLUT } from "../fractal/palette";
import type { PaletteSpec } from "../fractal/palette";
import { mulberry32 } from "../fractal/rng";
import type { Rng } from "../fractal/rng";
import type {
  ColorMode,
  FourDColorMode,
  SymmetryAxis,
  Transform,
  Transform4,
  Vec3,
  Vec4,
} from "../fractal/types";

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
      /** Contrast exponent for the coordinate-normalized color modes
       * (fr-8sk) — snapshotted at render entry exactly like `colorMode`. */
      colorGamma: number;
      /**
       * Structural-coloring palette (fr-1kt, mirroring the flame's fr-6us);
       * "legacy" = the existing colorMode-driven coloring; since fr-55k may
       * also be a self-contained `CustomPalette` payload.
       */
      palette: PaletteSpec;
      /**
       * Gradient palette for the colorMode-driven height/radius RAMPS
       * (fr-3b6) — deliberately named apart from `palette` above, because
       * this session carries TWO palette concepts: `palette` is the
       * STRUCTURAL orbit gradient that overrides `colorMode` entirely, while
       * `rampPalette` recolors the height/radius ramps within the
       * colorMode-driven `"legacy"` path, and so only matters while
       * `palette` is `"legacy"`. Snapshotted at render entry exactly like
       * `colorMode`/`colorGamma` — the ramp select is only reachable in the
       * points view, so there is no live command for it (unlike
       * `setPalette`). `"legacy"` = the built-in ramps.
       */
      rampPalette: PaletteSpec;
      /**
       * The position mode's custom axis colors (fr-8k7) — snapshotted at
       * render entry exactly like `colorMode`/`colorGamma`; the position
       * axis pickers are only reachable in the points view, so there is no
       * live command for it (mirrors `rampPalette`'s doc). Only matters
       * while `palette` is `"legacy"` (the colorMode-driven path) AND
       * `colorMode` is `"position"`; unused on the 4D path. Absent = the
       * legacy XYZ→RGB mapping.
       */
      positionAxisColors?: PositionAxisColors;
      iterationsBudget: number;
      /** Explicit numeric seed (not a live `Rng`, which can't cross
       * postMessage) — also makes a render a reproducible pure function of
       * its inputs. */
      seed: number;
      /**
       * Grid + texture memory ceiling in voxels, computed by the main thread
       * via {@link voxelAccumBudgetVoxels} — the device signals it reads
       * (`navigator.deviceMemory`, pointer coarseness) only exist there.
       * Omitted, the session falls back to the phone-safe floor.
       */
      maxVoxels?: number;
      /** Kaleidoscope symmetry (fr-6im) — see chaos-game.ts's prepareChaosGame. */
      order: number;
      axis: SymmetryAxis;
      /**
       * Optional 4D solid render (fr-4wd, mirroring the flame's fr-5b3):
       * present when the explorer was in 4D mode when the render was
       * entered. When present, the session drives `chaos-game-4d.ts`'s 4D
       * chaos game and `voxel-4d.ts`'s `computeVoxelBounds4`/
       * `accumulateVoxels4` instead of the 3D path. `transforms`/
       * `finalTransform`/`colorMode`/`colorGamma`/`rampPalette` above still
       * arrive either way (the main thread always sends both), but are
       * simply unused when this is present — the 4D view hides the contrast
       * control and never applied gamma to color (see `color.ts`'s
       * `buildColors4` doc), the radius LUT below uses gamma 1, and this
       * block carries its own `rampPalette` (fr-6ue), keeping it
       * structurally identical to the flame `start`'s so main.ts's one
       * `fourDRenderSnapshot` feeds both. Unlike the flame session, there
       * is no GPU backend to opt out of here: the voxel session is CPU-only
       * regardless of dimension.
       */
      fourD?: {
        /** The 4D transform set — see `chaos-game-4d.ts`'s `PreparedChaosGame4`. */
        transforms4: Transform4[];
        finalTransform4: Transform4 | null;
        /** Row-major 4x4 rotor matrix (the `affine4.ts`/`rotationMatrix4`
         * convention), frozen at render entry — see `project4.ts`'s
         * `composeRotorProjection4`. Built into one {@link RotorProjection4}
         * ONCE per session (the rotor never changes mid-render — only the
         * camera stays live). */
        rotor: number[];
        /** The cloud's 4D center (the rotor's pivot) — see
         * `composeRotorProjection4`. */
        center: Vec4;
        /** `1 / wSupport(rotor, halfExtents)` at render-entry — see
         * `project4.ts`'s `FourDView.invWAmp` and `rotor4.ts`'s `wSupport`. */
        invWAmp: number;
        /** Whether the soft w-slice is on — `scene.ts`'s `uSliceOn`. */
        sliceOn: boolean;
        /** Slice center in the normalized signed-w signal — `uSliceCenter`. */
        sliceCenter: number;
        /** Slice width — `uSliceWidth`, sent as a plain number (the main
         * thread reads `FOUR_D_SLICE_WIDTH`). */
        sliceWidth: number;
        /** Whether the w-ramp color modes recenter their ramp on the slice
         * window (fr-nn6) — `project4.ts`'s `FourDView.sliceRelativeColor`. */
        sliceRelativeColor: boolean;
        /** The explorer's active 4D color mode — drives the "legacy"
         * palette dispatch (see `color.ts`'s `FourDRenderColor`). */
        colorMode: FourDColorMode;
        /** Min/max 4D distance from `center` over the explorer's own cloud
         * (`ChaosGame4Result`), computed by the main thread — the "radius"
         * color mode's normalization range. */
        radiusMin: number;
        radiusMax: number;
        /**
         * Gradient palette for the "radius" color mode's ramp (fr-6ue) — the
         * same `rampPaletteId` selection the explorer's 3D height/radius
         * ramps follow, resolved by the main thread; `"legacy"` = the
         * built-in warm→cool ramp. Only the radius mode reads it;
         * snapshotted at render entry like the rest of this block.
         */
        rampPalette: PaletteSpec;
      };
    }
  | { type: "setIterationsBudget"; iterations: number }
  | { type: "setPalette"; palette: PaletteSpec }
  | { type: "setSymmetry"; order: number; axis: SymmetryAxis };

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
  /** Fallback voxel budget for `start` commands that don't carry their own
   * `maxVoxels` (defaults to the phone-safe 320 MiB floor); overridable so a
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
/**
 * Caps texture packing at roughly 1/{@link VOXEL_TEXTURE_PACK_DUTY} of total
 * worker time once packs get slow: the refresh threshold stretches to
 * `VOXEL_TEXTURE_PACK_DUTY * this.lastPackMs` whenever that exceeds
 * `VOXEL_TEXTURE_INTERVAL_MS` (the interval is measured from pack START, so
 * a threshold of `duty * lastPackMs` bounds packing to `1 / duty` of the time
 * between refreshes). At <=256^3 packs are fast enough that the flat 250 ms
 * floor still governs, so behavior there is unchanged.
 *
 * Without this, a slow pack is pathological: `lastTextureAt` is stamped at
 * pack START, so once a pack takes >= `VOXEL_TEXTURE_INTERVAL_MS` every
 * subsequent 8 ms accumulation chunk is immediately "due" again the instant
 * it returns, and the worker spends nearly all its time re-packing instead of
 * accumulating. Packing is O(size^3) — tens of ms at 192^3, but roughly
 * ~500 ms at 512^3 — so raising the desktop ceiling to 512^3 (fr-8x7) is what
 * made the fixed stride pathological; the flame worker needs no equivalent
 * guard because its per-refresh output is display-resolution, not O(size^3).
 */
const VOXEL_TEXTURE_PACK_DUTY = 3;

/** Bytes per voxel across everything a session allocates per voxel: Float32
 * density (4) + Float32 RGB running mean (12) + the RGBA8 texture (4). */
const BYTES_PER_VOXEL = 20;
const MIB = 1024 * 1024;
/**
 * Phone-safe floor (and no-better-information default) for one session's
 * grid + texture. 320 MiB / 20 bytes is exactly 256^3 — the value the app
 * shipped with since fr-v4f, so coarse-pointer devices keep exactly their old
 * behavior (the old 256-max slider passes untouched). Same reasoning as the
 * flame's floor (`FLAME_ACCUM_FLOOR_BYTES`): phones die uncatchably (the OS
 * kills the tab before an allocation ever throws), so they get a conservative
 * flat budget, while desktops fail catchably and get more.
 */
const VOXEL_ACCUM_FLOOR_BYTES = 320 * MIB;
const VOXEL_FLOOR_VOXELS = Math.floor(
  VOXEL_ACCUM_FLOOR_BYTES / BYTES_PER_VOXEL,
);
/** Desktop budget scale: grid+texture bytes allowed per GiB of *reported*
 * device memory. 320 MiB/GiB lands an 8-GiB report exactly on the ceiling
 * (same scale as the flame's `FLAME_ACCUM_BYTES_PER_GIB`). */
const VOXEL_ACCUM_BYTES_PER_GIB = 320 * MIB;
/**
 * Desktop ceiling. 2560 MiB is exactly 512^3 voxels x 20 bytes — the new
 * slider maximum passes untouched on any machine reporting 8 GiB
 * (`navigator.deviceMemory`'s cap, meaning "8 or more"); a modest slice of
 * such a machine, and the reactive allocation-failure ratchet
 * (`maxSafeResolution`) still backstops weaker ones.
 */
const VOXEL_ACCUM_MAX_BYTES = 2560 * MIB;

/**
 * The grid+texture memory budget (in voxels — see {@link BYTES_PER_VOXEL})
 * for the device we're actually running on, from the two signals only the
 * MAIN thread can read; it computes this and ships the result in the `start`
 * command (fr-8x7, mirroring the flame's fr-7c8 — see
 * `flame-worker-core.ts`'s `flameAccumBudgetBuckets`). Before this, the
 * budget was a flat 320 MiB sized so the OLD 256 slider max fit exactly on
 * every device — i.e. desktops were pinned to a phone-derived resolution
 * ceiling no matter how much RAM they actually had.
 *
 * - `coarsePointer` (from `matchMedia("(pointer: coarse)")`) marks
 *   phone/tablet-class devices: they keep the flat floor, and their
 *   `deviceMemory` is deliberately IGNORED — flagship phones report the
 *   capped maximum of 8 despite being exactly the devices the conservative
 *   floor exists for (see {@link VOXEL_ACCUM_FLOOR_BYTES}).
 * - `deviceMemoryGiB` (`navigator.deviceMemory`: Chromium-only, quantized,
 *   capped at 8) scales the desktop budget. Where it's unavailable
 *   (Firefox/Safari) a fine-pointer device is assumed desktop-class (8):
 *   optimistic, but desktops fail catchably, and a genuinely weaker machine
 *   is still protected by `startAccumulation`'s reactive OOM fallback plus
 *   the session's learned `maxSafeResolution` ceiling.
 */
export function voxelAccumBudgetVoxels(
  deviceMemoryGiB: number | undefined,
  coarsePointer: boolean,
): number {
  if (coarsePointer) return VOXEL_FLOOR_VOXELS;
  const bytes = (deviceMemoryGiB ?? 8) * VOXEL_ACCUM_BYTES_PER_GIB;
  const clamped = Math.min(
    VOXEL_ACCUM_MAX_BYTES,
    Math.max(VOXEL_ACCUM_FLOOR_BYTES, bytes),
  );
  return Math.floor(clamped / BYTES_PER_VOXEL);
}

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
  /** Fallback budget for starts that don't carry one — see VoxelWorkerDeps. */
  private readonly defaultMaxVoxels: number;
  /** The budget the CURRENT session runs under: the `start` command's
   * device-aware value (see {@link voxelAccumBudgetVoxels}), or the
   * fallback when the command carried none. */
  private maxVoxels: number;
  private readonly initialChunkSize: number;
  private readonly boundsSamples: number | undefined;

  private prepared: PreparedChaosGame | null = null;
  private palette: ReturnType<typeof transformColors> = [];
  private rng: Rng = Math.random;
  private colorMode: ColorMode = "transform";
  /** The position mode's custom axis colors (fr-8k7) — see `voxel.ts`'s
   * `accumulateVoxels`. */
  private positionAxisColors: PositionAxisColors | undefined;
  /** Contrast exponent for the coordinate-normalized color modes (fr-8sk) —
   * see `voxel.ts`'s `accumulateVoxels`. */
  private colorGamma = 1;
  /** Gradient palette for the colorMode-driven height/radius ramps (fr-3b6)
   * — see the `start` command's `rampPalette` doc for how it differs from
   * `colorLUT` below (the STRUCTURAL palette, which overrides colorMode and
   * so makes this inert while non-null). */
  private rampPalette: PaletteSpec = "legacy";
  /** Gradient lookup table for structural coloring, or `null` for the
   * colorMode-driven `"legacy"` palette — see `voxel.ts`'s `accumulateVoxels`. */
  private colorLUT: Float32Array | null = null;
  private grid: VoxelGrid | null = null;
  private bounds: VoxelBounds | null = null;

  /** True when the current session's `start` carried a `fourD` block — see
   * that field's doc. Set once per `start`; a restart (setPalette) never
   * toggles it, since a session's dimensionality doesn't change mid-life,
   * only a brand-new `start` can — mirrors flame-worker-core's `is4D`. */
  private is4D = false;
  private prepared4: PreparedChaosGame4 | null = null;
  /** The 20-coefficient rotor projection `composeRotorProjection4` builds —
   * built ONCE in `start` (the rotor is frozen for the whole session, unlike
   * the flame session's `projection4` there is no camera to fold in here:
   * the solid render is world-space, so this alone is the projection). */
  private rotorProj4: RotorProjection4 | null = null;
  private fourDView: FourDView | null = null;
  private fourDColorMode: FourDColorMode = "wBlueOrange";
  private fourDCenter: Vec4 = [0, 0, 0, 0];
  private fourDRadiusMin = 0;
  private fourDRadiusMax = 1;
  private fourDRampPalette: PaletteSpec = "legacy";
  /** Built once per `startAccumulation` (never per chunk — see
   * `buildFourDColor`) from the current `colorLUT` and the `fourD` block's
   * `colorMode`. `null` for a 3D session. */
  private fourDColor: FourDRenderColor | null = null;

  /** The raw (un-rotated) transforms/finalTransform from the last "start" —
   * retained so setSymmetry can re-prepare with a NEW symmetry without the
   * main thread resending the whole transform list. */
  private baseTransforms: Transform[] = [];
  private baseFinalTransform: Transform | null = null;
  /** The symmetry actually baked into `this.prepared` right now — lets
   * setSymmetry no-op a repeat value instead of restarting for nothing (the
   * order slider fires "input" continuously while dragging, and can report
   * the same integer step's value more than once in a row). */
  private symmetryOrder = 1;
  private symmetryAxis: SymmetryAxis = "y";

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
  /** Wall-clock cost (ms) of the last texture pack — feeds the pack-duty
   * throttle stretch in `runChunk`; 0 until the first pack completes. */
  private lastPackMs = 0;
  private chunkSize: number;
  /** True while a chunk is scheduled or in flight — guards against
   * double-scheduling the loop. */
  private running = false;

  constructor(deps: VoxelWorkerDeps) {
    this.now = deps.now;
    this.schedule = deps.schedule;
    this.emit = deps.emit;
    this.createGrid = deps.createGrid ?? createVoxelGrid;
    this.defaultMaxVoxels = deps.maxVoxels ?? VOXEL_FLOOR_VOXELS;
    this.maxVoxels = this.defaultMaxVoxels;
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
      case "setPalette":
        this.setPalette(command.palette);
        break;
      case "setSymmetry":
        this.setSymmetry(command.order, command.axis);
        break;
    }
  }

  private start(cmd: Extract<VoxelWorkerCommand, { type: "start" }>): void {
    this.baseTransforms = cmd.transforms;
    this.baseFinalTransform = cmd.finalTransform;
    this.symmetryOrder = cmd.order;
    this.symmetryAxis = cmd.axis;
    // Built unconditionally, mirroring flame-worker-core's own `start`: even
    // in a 4D session these still arrive (the main thread always sends
    // both) but are simply unused.
    this.prepared = prepareChaosGame(cmd.transforms, cmd.finalTransform, {
      order: cmd.order,
      axis: cmd.axis,
    });
    this.palette = transformColors(cmd.transforms.length);
    this.rng = mulberry32(cmd.seed);
    this.colorMode = cmd.colorMode;
    this.positionAxisColors = cmd.positionAxisColors;
    this.colorGamma = cmd.colorGamma;
    this.rampPalette = cmd.rampPalette;
    // null for "legacy" — accumulateVoxels/buildFourDColor then falls back
    // to colorMode/the explorer's 4D color mode respectively.
    this.colorLUT = buildPaletteLUT(cmd.palette);
    this.iterationsBudget = cmd.iterationsBudget;
    this.requestedResolution = cmd.resolution;
    this.maxVoxels = cmd.maxVoxels ?? this.defaultMaxVoxels;
    this.maxSafeResolution = Infinity; // a fresh session has no learned ceiling yet.

    this.is4D = cmd.fourD !== undefined;
    if (cmd.fourD) {
      const fourD = cmd.fourD;
      this.prepared4 = prepareChaosGame4(
        fourD.transforms4,
        fourD.finalTransform4,
      );
      // The rotor is frozen for the whole session — built once here, unlike
      // the flame session's projection4 there is no camera to fold on top:
      // the solid render is world-space.
      this.rotorProj4 = composeRotorProjection4(fourD.rotor, fourD.center);
      this.fourDView = {
        invWAmp: fourD.invWAmp,
        sliceOn: fourD.sliceOn,
        sliceCenter: fourD.sliceCenter,
        sliceWidth: fourD.sliceWidth,
        sliceRelativeColor: fourD.sliceRelativeColor,
      };
      this.fourDColorMode = fourD.colorMode;
      this.fourDCenter = fourD.center;
      this.fourDRadiusMin = fourD.radiusMin;
      this.fourDRadiusMax = fourD.radiusMax;
      this.fourDRampPalette = fourD.rampPalette;
    } else {
      this.prepared4 = null;
      this.rotorProj4 = null;
      this.fourDView = null;
    }

    // The bounds pilot is part of the same seeded run, so a given seed
    // produces one reproducible render, bounds included.
    this.bounds = this.is4D
      ? computeVoxelBounds4(
          this.prepared4!,
          this.rotorProj4!,
          this.fourDView!,
          this.rng,
          this.boundsSamples,
        )
      : computeVoxelBounds(this.prepared, this.rng, this.boundsSamples);
    this.startAccumulation();
  }

  /**
   * Whether `start` has populated this session's geometry — 3D `prepared`,
   * or (for a 4D session) `prepared4`/`rotorProj4`/`fourDView` — the shared
   * "is there an active session to restart/run" gate every live-command
   * handler uses, mirroring flame-worker-core's own `hasGeometry`.
   */
  private hasGeometry(): boolean {
    return this.is4D
      ? this.prepared4 !== null &&
          this.rotorProj4 !== null &&
          this.fourDView !== null
      : this.prepared !== null;
  }

  /**
   * Build this session's {@link FourDRenderColor} from the CURRENT
   * `colorLUT` and the `start` command's `fourD` block — called once per
   * `startAccumulation` (never per chunk), so a live `setPalette` rebuilds
   * it fresh on every restart. A non-null `colorLUT` always wins (structural
   * coloring, exactly mirroring the 3D path's own `colorLUT !== null`
   * precedence); `null` (`"legacy"`) dispatches on the explorer's own 4D
   * color mode — see `color.ts`'s `FourDRenderColor` doc for what each
   * variant reproduces. Reuses flame-worker-core's `buildFourDColor` shape
   * exactly, so the two sessions read alike.
   */
  private buildFourDColor(): FourDRenderColor {
    if (this.colorLUT !== null) {
      return { kind: "structural", lut: this.colorLUT };
    }
    switch (this.fourDColorMode) {
      case "wBlueOrange":
      case "wPurpleGreen":
      case "wCyanMagenta":
        return { kind: "wRamp", side: W_SIDE_PALETTES[this.fourDColorMode] };
      case "transform":
        return {
          kind: "transform",
          palette: transformColors(this.prepared4?.transformCount ?? 0),
        };
      case "radius":
        return {
          kind: "radius",
          lut: buildColorModeLUT("radius", 1, this.fourDRampPalette),
          center: this.fourDCenter,
          minD: this.fourDRadiusMin,
          maxD: this.fourDRadiusMax,
        };
    }
  }

  /**
   * Live palette change (fr-1kt, mirroring the flame session's `setPalette`):
   * avgRGB has the OLD palette's colors baked in as a running mean, so —
   * unlike a GPU-uniform param — this can't be re-applied to the existing
   * accumulation; it has to accumulate afresh. Bounds/resolution are
   * unchanged (color doesn't move geometry, so the bounds pilot does NOT
   * re-run), so this reallocates an identical-size grid at the same bounds
   * — the same restart path setSymmetry uses.
   */
  private setPalette(palette: PaletteSpec): void {
    if (!this.hasGeometry()) return; // no active session yet.
    this.colorLUT = buildPaletteLUT(palette);
    this.startAccumulation();
  }

  private setSymmetry(order: number, axis: SymmetryAxis): void {
    if (!this.hasGeometry()) return; // no active session yet.
    // Symmetry (fr-6im) is 3D-only: the UI hides the control while a 4D
    // session is active, but guard here too rather than trust that. A 4D
    // session has no `postRotations`/base-map bookkeeping to rebuild, so
    // there is nothing for this command to actually do — mirrors
    // flame-worker-core's own `setSymmetry` guard.
    if (this.is4D) return;
    if (order === this.symmetryOrder && axis === this.symmetryAxis) return;
    this.symmetryOrder = order;
    this.symmetryAxis = axis;
    this.prepared = prepareChaosGame(
      this.baseTransforms,
      this.baseFinalTransform,
      { order, axis },
    );
    // Symmetry changes the attractor's spatial extent — a kaleidoscope can be
    // considerably wider than the base system — so the bounds pilot has to
    // rerun too, not just the accumulation (unlike setIterationsBudget above,
    // which never touches geometry). Reuses `this.rng` where it currently
    // sits, same as `start()` uses it fresh — a restart was never meant to be
    // bit-for-bit replayable against the original seed, only internally
    // consistent from here on.
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
   * supersample fallback. Dimension-agnostic: the grid itself (and this OOM
   * guard) doesn't care whether it's being filled by the 3D or 4D path.
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
    this.lastPackMs = 0;
    this.chunkSize = this.initialChunkSize;
    // The color sums a fresh accumulation will produce depend on the
    // CURRENT colorLUT/fourDColorMode — rebuilt here (not just in `start`)
    // so a live setPalette's restart picks up the new palette (see
    // buildFourDColor's doc).
    if (this.is4D) {
      this.fourDColor = this.buildFourDColor();
    }
    this.emit({
      type: "resolutionNote",
      effective: effective < this.requestedResolution ? effective : null,
      requested: this.requestedResolution,
    });
    this.ensureRunning();
  }

  private ensureRunning(): void {
    if (this.running) return;
    if (!this.hasGeometry() || !this.grid) return;
    if (this.iterationsDone >= this.iterationsBudget) return;
    this.running = true;
    this.schedule(() => this.runChunk());
  }

  private runChunk(): void {
    const grid = this.grid;
    // Re-checked here, not just in ensureRunning's gate: a budget LOWERED
    // below iterationsDone between scheduling and firing must stop here, or
    // the chunk math below goes negative (see flame-worker-core's runChunk).
    if (
      !grid ||
      !this.hasGeometry() ||
      this.iterationsDone >= this.iterationsBudget
    ) {
      this.running = false;
      return;
    }

    const chunk = Math.min(
      this.chunkSize,
      this.iterationsBudget - this.iterationsDone,
    );
    const t0 = this.now();
    if (this.is4D) {
      accumulateVoxels4(
        this.prepared4!,
        grid,
        chunk,
        this.rng,
        this.rotorProj4!,
        this.fourDView!,
        this.fourDColor!,
      );
    } else {
      accumulateVoxels(
        this.prepared!,
        grid,
        chunk,
        this.rng,
        this.palette,
        this.colorMode,
        this.colorLUT ?? undefined,
        this.colorGamma,
        this.rampPalette,
        this.positionAxisColors,
      );
    }
    const t1 = this.now();
    this.iterationsDone += chunk;
    this.adaptChunkSize(t1 - t0);

    const finished = this.iterationsDone >= this.iterationsBudget;
    const textureInterval = Math.max(
      VOXEL_TEXTURE_INTERVAL_MS,
      VOXEL_TEXTURE_PACK_DUTY * this.lastPackMs,
    );
    const due =
      finished ||
      this.lastTextureAt === undefined ||
      t1 - this.lastTextureAt >= textureInterval;
    if (due) {
      this.lastTextureAt = t1;
      if (!this.sendGrid(grid)) {
        this.running = false;
        return;
      }
      this.lastPackMs = this.now() - t1;
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
