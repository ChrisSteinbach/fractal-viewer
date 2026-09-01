/**
 * The solid render's Web Worker session state machine: bounds
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
 * worker. Only the iteration budget, the palette (restarts accumulation
 * the same way, since baked-in colors can't be reapplied live),
 * the shared legacy-color inputs (also baked, but staged without work under a
 * structural palette), the settled 4D rotor/slice view, and the symmetry (it
 * reshapes the geometry itself, not a tone-map param, so it restarts
 * accumulation like the flame session's `setSymmetry`) are live here.
 */
import {
  accumulateVoxels,
  computeVoxelBounds,
  createVoxelGrid,
  voxelTextureData,
} from "../fractal/voxel";
import type { VoxelBounds, VoxelGrid } from "../fractal/voxel";
import { buildVoxelMaxHierarchy } from "../fractal/voxel-max-hierarchy";
import type {
  VoxelMaxHierarchy,
  VoxelMaxHierarchyLevel,
} from "../fractal/voxel-max-hierarchy";
import {
  clampVoxelResolutionToMemoryBudget,
  voxelResolutionMemoryByteLength,
} from "../fractal/voxel-memory";
import {
  accumulateVoxels4,
  computeVoxelBounds4,
  prepareVoxelPointTiling4,
} from "../fractal/voxel-4d";
import type { PreparedVoxelPointTiling4 } from "../fractal/voxel-4d";
import { symmetryIsNonFlat } from "../fractal/affine4";
import { prepareChaosGame } from "../fractal/chaos-game";
import type { PreparedChaosGame } from "../fractal/chaos-game";
import { prepareChaosGame4 } from "../fractal/chaos-game-4d";
import type { PreparedChaosGame4 } from "../fractal/chaos-game-4d";
import {
  buildColorModeLUT,
  fourDColorNeedsAttribute,
  sameFlatRenderColorInputs,
  sameFourDRenderColorInputs,
  transformColors,
  UNIFORM_POINT_COLOR,
  W_SIDE_PALETTES,
} from "../fractal/color";
import type {
  FourDRenderColor,
  PositionAxisColors,
  RenderColorInputs,
} from "../fractal/color";
import { composeRotorProjection4 } from "../fractal/project4";
import type { FourDView, RotorProjection4 } from "../fractal/project4";
import { buildPaletteLUT } from "../fractal/palette";
import type { PaletteSpec } from "../fractal/palette";
import type { PointTilingPlan } from "../fractal/point-tiling";
import { resolvePointTilingSession } from "../fractal/point-tiling-session";
import { mulberry32 } from "../fractal/rng";
import type { Rng } from "../fractal/rng";
import {
  hasMeshAsset,
  installCustomMeshAsset,
  installSerializedCustomMeshAsset,
  prepareSerializedCustomMeshAsset,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import type {
  ColorMode,
  FourDColorMode,
  HybridSchedule,
  SymmetryParams,
  SymmetryPlane,
  Transform,
  Transform4,
  Vec3,
  Vec4,
} from "../fractal/types";
import {
  fourDWorkerViewNeedsRebuild,
  sameFourDWorkerView,
  sameFourDWorkerSpatialView,
  type FourDWorkerView,
} from "./four-d-worker-view";
import { wSupport } from "./rotor4";
import { MAX_CUSTOM_MESHES_PER_SCENE } from "../fractal/custom-mesh";
import type { TilingSpec } from "../fractal/tiling";

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

function sameMeshSource(
  left: SerializedPreparedMeshAsset,
  right: SerializedPreparedMeshAsset,
): boolean {
  return (
    left.vertices instanceof Float64Array &&
    right.vertices instanceof Float64Array &&
    left.triangles instanceof Uint32Array &&
    right.triangles instanceof Uint32Array &&
    left.vertices.length === right.vertices.length &&
    left.triangles.length === right.triangles.length &&
    left.vertices.every((value, index) =>
      Object.is(value, right.vertices[index]),
    ) &&
    left.triangles.every((value, index) => value === right.triangles[index])
  );
}

function installStartMeshAssets(
  wires: readonly SerializedPreparedMeshAsset[] = [],
): void {
  if (wires.length > MAX_CUSTOM_MESHES_PER_SCENE) {
    throw new RangeError("too many custom mesh sources in start command");
  }
  for (let index = 0; index < wires.length; index += 1) {
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (
        wires[earlier].id === wires[index].id &&
        !sameMeshSource(wires[earlier], wires[index])
      ) {
        throw new RangeError("serialized mesh conflicts within start command");
      }
    }
  }
  for (const wire of wires) {
    if (hasMeshAsset(wire.id)) installSerializedCustomMeshAsset(wire);
  }
  const stagedIds = new Set<string>();
  const staged = [];
  for (const wire of wires) {
    if (hasMeshAsset(wire.id) || stagedIds.has(wire.id)) continue;
    staged.push(prepareSerializedCustomMeshAsset(wire));
    stagedIds.add(wire.id);
  }
  for (const asset of staged) installCustomMeshAsset(asset);
}

/** Main thread → worker. */
export type VoxelWorkerCommand =
  | {
      type: "start";
      /** Custom mesh sources referenced by either dimensional transform set.
       * The worker validates the full batch before mutating its realm-local
       * registry or preparing either chaos game. */
      meshAssets?: readonly SerializedPreparedMeshAsset[];
      transforms: Transform[];
      finalTransform: Transform | null;
      /** Requested voxels per axis; the session clamps to its memory budget. */
      resolution: number;
      /** The explorer's active color mode, carried into the voxel colors
       * — see `accumulateVoxels`' coloring doc. */
      colorMode: ColorMode;
      /** Initial contrast exponent for the coordinate-normalized color modes;
       * the atomic `setColorInputs` command keeps it current in-session. */
      colorGamma: number;
      /**
       * Structural-coloring palette (mirroring the flame's);
       * "legacy" = the existing colorMode-driven coloring, and it may
       * also be a self-contained `CustomPalette` payload.
       */
      palette: PaletteSpec;
      /**
       * Gradient palette for the colorMode-driven height/radius RAMPS
       * — deliberately named apart from `palette` above, because
       * this session carries TWO palette concepts: `palette` is the
       * STRUCTURAL orbit gradient that overrides `colorMode` entirely, while
       * `rampPalette` recolors the height/radius ramps within the
       * colorMode-driven `"legacy"` path, and so only matters while
       * `palette` is `"legacy"`. Initially snapshotted with
       * `colorMode`/`colorGamma`; the shared Color editor's atomic
       * `setColorInputs` command keeps it current while the session is live.
       * `"legacy"` = the built-in ramps.
       */
      rampPalette: PaletteSpec;
      /**
       * The position mode's custom axis colors — initially snapshotted at
       * render entry exactly like `colorMode`/`colorGamma`, then updated by
       * the same atomic `setColorInputs` command. Only matters
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
       * Exact worker peak-memory ceiling in bytes, computed by the main thread
       * via {@link voxelAccumBudgetBytes} — the device signals it reads
       * (`navigator.deviceMemory`, pointer coarseness) only exist there.
       * Omitted, the session falls back to the phone-safe floor.
       */
      maxBytes?: number;
      /** Kaleidoscope symmetry, 4D as well as 3D — which is also why
       * `twist` rides along (the second angle of a 4D double rotation, which
       * only the 4D path can express). Absent `twist` means 0. */
      order: number;
      plane: SymmetryPlane;
      twist?: number;
      /**
       * Optional scheduled-hybrid post-word block (`types.ts`'s
       * {@link HybridSchedule}), in the document's flat 3D form for BOTH
       * dimensions — the flame start command's field, verbatim. Omitted/
       * absent, both prepares take their byte-identical no-post-word paths.
       */
      schedule?: HybridSchedule | null;
      /** Raw authored tiling. A 4D session resolves its worker-local typed
       * array plan before constructing the seeded orbit; 3D leaves it to the
       * live material arm. */
      tiling?: TilingSpec | null;
      /** Authored Balloon legality bit. No echo payload enters the voxel
       * tiling path; this only preserves the shared composition refusal. */
      balloonEchoEnabled?: boolean;
      /**
       * Optional 4D solid render (mirroring the flame's):
       * present when the explorer was in 4D mode when the render was
       * entered. When present, the session drives `chaos-game-4d.ts`'s 4D
       * chaos game and `voxel-4d.ts`'s `computeVoxelBounds4`/
       * `accumulateVoxels4` instead of the 3D path. `transforms`/
       * `finalTransform`/`colorMode`/`colorGamma`/`rampPalette` above still
       * arrive either way (the main thread always sends both), but are
       * simply unused when this is present — the 4D view hides the contrast
       * control and never applied gamma to color (see `color.ts`'s
       * `buildColors4` doc), the radius LUT below uses gamma 1, and this
       * block carries its own `rampPalette`, keeping it
       * structurally identical to the flame `start`'s so main.ts's one
       * `fourDRenderSnapshot` feeds both. Unlike the flame session, there
       * is no GPU backend to opt out of here: the voxel session is CPU-only
       * regardless of dimension.
       */
      fourD?: {
        /** The 4D transform set — see `chaos-game-4d.ts`'s `PreparedChaosGame4`. */
        transforms4: Transform4[];
        finalTransform4: Transform4 | null;
        /** Initial row-major 4x4 rotor matrix (the
         * `affine4.ts`/`rotationMatrix4` convention) — see `project4.ts`'s
         * `composeRotorProjection4`. A settled `setFourDView` may replace it,
         * re-pilot bounds, and restart accumulation. */
        rotor: number[];
        /** The cloud's 4D center (the rotor's pivot) — see
         * `composeRotorProjection4`. */
        center: Vec4;
        /** Half-extents of the active entry cloud's 4D bounds. Retained by
         * the worker so every later rotor endpoint recomputes signed-w
         * normalization against this session's support, never a newer
         * document cloud. */
        halfExtents: Vec4;
        /** Optional canonical-source color normalization frame. Active 4D
         * tiling uses an origin/carrier geometry pivot while source-owned
         * Height/Radius/Position retain this independent frame. */
        colorCenter?: Vec4;
        colorHalfExtents?: Vec4;
        /** Rotation-invariant entry carrier retained across an active tiled
         * session becoming Off/refused. Absent means ordinary AABB support. */
        entryCarrierRadius?: number;
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
         * window — `project4.ts`'s `FourDView.sliceRelativeColor`. */
        sliceRelativeColor: boolean;
        /** The explorer's active 4D color mode — drives the "legacy"
         * palette dispatch (see `color.ts`'s `FourDRenderColor`). */
        colorMode: FourDColorMode;
        /** Shared contrast exponent for Height/Radius/Position. */
        colorGamma?: number;
        /** Position mode's custom XYZ axis colors; absent is legacy XYZ→RGB. */
        positionAxisColors?: PositionAxisColors;
        /** Min/max 4D distance from `center` over the explorer's own cloud
         * (`ChaosGame4Result`), computed by the main thread — the "radius"
         * color mode's normalization range. */
        radiusMin: number;
        radiusMax: number;
        /**
         * Gradient palette for the "radius" color mode's ramp — the
         * same `rampPaletteId` selection the explorer's 3D height/radius
         * ramps follow, resolved by the main thread; `"legacy"` = the
         * built-in warm→cool ramp. Only the radius mode reads it; initially
         * snapshotted at render entry, then kept current by the shared Color
         * editor's atomic `setColorInputs` command.
         */
        rampPalette: PaletteSpec;
      };
    }
  | { type: "setIterationsBudget"; iterations: number }
  | { type: "setPalette"; palette: PaletteSpec }
  | { type: "setColorInputs"; inputs: RenderColorInputs }
  | {
      type: "setFourDView";
      /**
       * A settled manual rotor/slice endpoint. The worker retains the active
       * entry geometry and centre, re-pilots projected bounds, then starts a
       * fresh voxel accumulation. A flat session ignores this command.
       */
      view: FourDWorkerView;
      /** Main-thread endpoint revision, echoed by generation-bearing events
       * so queued results from superseded endpoints can be rejected. */
      viewRevision?: number;
    }
  | {
      type: "setSymmetry";
      order: number;
      plane: SymmetryPlane;
      /** See the `start` command's own `twist`. */
      twist?: number;
    };

/**
 * Threshold-independent empty-space acceleration built from the exact packed
 * texture carried beside it. `absent` is an honest, usable fallback: the main
 * thread must install the texture and use its unaccelerated Solid march.
 */
export type VoxelWorkerHierarchyPayload =
  | {
      readonly status: "present";
      readonly data: Uint8Array<ArrayBuffer>;
      readonly levels: readonly Readonly<VoxelMaxHierarchyLevel>[];
      readonly byteLength: number;
      readonly sourceSize: number;
    }
  | { readonly status: "absent" };

/** Worker → main thread. */
export type VoxelWorkerEvent =
  | {
      type: "grid";
      /** RGBA8 3D-texture bytes (see `voxelTextureData`), transferred (zero-copy). */
      texture: Uint8Array<ArrayBuffer>;
      /** Max hierarchy derived from THIS texture, or an explicit fallback. */
      hierarchy: VoxelWorkerHierarchyPayload;
      /** Voxels per axis of `texture` — the EFFECTIVE (post-clamp) resolution. */
      size: number;
      boundsMin: Vec3;
      boundsMax: Vec3;
      iterationsDone: number;
      iterationsBudget: number;
      /** Settled 4D endpoint revision baked into this density/hierarchy pair. */
      viewRevision?: number;
    }
  | {
      type: "resolutionNote";
      /** Maps onto `Ui.setSolidResolutionNote`'s signature, mirroring the
       * flame's supersampleNote: `null` = running at the requested value. */
      effective: number | null;
      requested?: number;
    }
  | {
      /**
       * Emitted synchronously, right where {@link VoxelWorkerSession}'s
       * `startAccumulation` discards the in-flight accumulation (mirroring
       * the flame session's own `restarted` event) — a live
       * `setPalette`/`setFourDView`/`setSymmetry` restart, the
       * allocation-failure fallback, or the initial `start` (harmless there:
       * nothing stale is on screen yet to correct). The next `grid` report — the only other thing that
       * carries `iterationsDone`/`iterationsBudget` — can be seconds away on
       * a big grid, so without this the main thread keeps showing the
       * PRE-restart count until that first post-restart pack lands. Carries
       * `iterationsBudget` (the new accumulation's target) so a listener can
       * zero its displayed count without waiting on anything else.
       */
      type: "restarted";
      iterationsBudget: number;
      /** Settled 4D endpoint revision this restart will build. */
      viewRevision?: number;
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
      /** Settled 4D endpoint revision these counters describe. */
      viewRevision?: number;
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
  /** Defaults to the real {@link voxelTextureData}; injectable so tests can
   * prove that texture-pack failure remains fatal and never publishes a
   * hierarchy without its source texture. */
  textureData?: typeof voxelTextureData;
  /** Defaults to the real {@link buildVoxelMaxHierarchy}; allocation failure
   * is non-fatal because the packed texture remains a complete render path. */
  buildHierarchy?: typeof buildVoxelMaxHierarchy;
  /** Defaults to the real {@link computeVoxelBounds4}; overridable so tests
   * can inspect the worker-owned view normalization passed to the 4D pilot. */
  computeBounds4?: typeof computeVoxelBounds4;
  /** Defaults to the real {@link accumulateVoxels4}; injectable so tests can
   * prove the prepared tiling policy reaches every worker chunk. */
  accumulate4?: typeof accumulateVoxels4;
  /** Fallback byte budget for `start` commands that don't carry their own
   * `maxBytes` (defaults to the exact peak for 256 cubed); overridable so a
   * test can trigger the proactive memory guard cheaply. */
  maxBytes?: number;
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
 * ~500 ms at 512^3 — so raising the desktop ceiling to 512^3 is what
 * made the fixed stride pathological; the flame worker needs no equivalent
 * guard because its per-refresh output is display-resolution, not O(size^3).
 */
const VOXEL_TEXTURE_PACK_DUTY = 3;

/**
 * Phone-safe floor (and no-better-information default) for one session's
 * exact peak: retained Float32 density/RGB, packed RGBA8, and max hierarchy.
 * It is the precise peak for 256 cubed, preserving the app's shipped phone
 * ceiling while making the new acceleration bytes part of the guard. Same
 * reasoning as the flame's floor: phone OOMs can kill the tab before an
 * allocation throws, so coarse-pointer devices get a flat budget.
 */
const VOXEL_ACCUM_FLOOR_BYTES = voxelResolutionMemoryByteLength(256);
/**
 * Desktop ceiling: the precise full-payload peak for 512 cubed, so the slider
 * maximum remains available on a machine reporting 8 GiB. The reactive
 * allocation-failure ratchet still backstops weaker machines.
 */
const VOXEL_ACCUM_MAX_BYTES = voxelResolutionMemoryByteLength(512);
/** Linear desktop scale landing an 8-GiB report exactly on the ceiling. */
const VOXEL_ACCUM_BYTES_PER_GIB = VOXEL_ACCUM_MAX_BYTES / 8;

/**
 * The exact peak-memory budget in bytes for the device we're actually
 * running on, from the two signals only the
 * MAIN thread can read; it computes this and ships the result in the
 * `start` command (mirroring the flame's — see `flame-worker-core.ts`'s
 * `flameAccumBudgetBuckets`). Before hierarchy accounting, the budget was a
 * nominal 320 MiB sized so the old 256 slider max fit exactly — i.e.
 * desktops were pinned to a phone-derived resolution ceiling no matter how
 * much RAM they actually had.
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
export function voxelAccumBudgetBytes(
  deviceMemoryGiB: number | undefined,
  coarsePointer: boolean,
): number {
  if (coarsePointer) return VOXEL_ACCUM_FLOOR_BYTES;
  const bytes = (deviceMemoryGiB ?? 8) * VOXEL_ACCUM_BYTES_PER_GIB;
  const clamped = Math.min(
    VOXEL_ACCUM_MAX_BYTES,
    Math.max(VOXEL_ACCUM_FLOOR_BYTES, bytes),
  );
  return Math.floor(clamped);
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Transfer ownership of every fresh payload buffer exactly once. */
export function voxelWorkerEventTransferBuffers(
  event: VoxelWorkerEvent,
): ArrayBuffer[] {
  if (event.type !== "grid") return [];
  return event.hierarchy.status === "present"
    ? [event.texture.buffer, event.hierarchy.data.buffer]
    : [event.texture.buffer];
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
  private readonly textureData: typeof voxelTextureData;
  private readonly buildHierarchy: typeof buildVoxelMaxHierarchy;
  /** Latched off after one hierarchy failure so progressive packs do not
   * repeatedly allocate under the same session-wide memory pressure. */
  private hierarchyEnabled = true;
  private readonly computeBounds4: typeof computeVoxelBounds4;
  private readonly accumulate4: typeof accumulateVoxels4;
  /** Fallback budget for starts that don't carry one — see VoxelWorkerDeps. */
  private readonly defaultMaxBytes: number;
  /** The budget the CURRENT session runs under: the `start` command's
   * device-aware value (see {@link voxelAccumBudgetBytes}), or the
   * fallback when the command carried none. */
  private maxBytes: number;
  private readonly initialChunkSize: number;
  private readonly boundsSamples: number | undefined;

  private prepared: PreparedChaosGame | null = null;
  private palette: ReturnType<typeof transformColors> = [];
  private rng: Rng = Math.random;
  private colorMode: ColorMode = "transform";
  /** The position mode's custom axis colors — see `voxel.ts`'s
   * `accumulateVoxels`. */
  private positionAxisColors: PositionAxisColors | undefined;
  /** Contrast exponent for the coordinate-normalized color modes —
   * see `voxel.ts`'s `accumulateVoxels`. */
  private colorGamma = 1;
  /** Gradient palette for the colorMode-driven height/radius ramps
   * — see the `start` command's `rampPalette` doc for how it differs from
   * `colorLUT` below (the STRUCTURAL palette, which overrides colorMode and
   * so makes this inert while non-null). */
  private rampPalette: PaletteSpec = "legacy";
  /** Gradient lookup table for structural coloring, or `null` for the
   * colorMode-driven `"legacy"` palette — see `voxel.ts`'s `accumulateVoxels`. */
  private colorLUT: Float32Array | null = null;
  /** The primary structural palette selection. Retained separately from its
   * LUT so a shared-color edit can stage under a nonlegacy override without
   * restarting, then become effective if `setPalette` returns to legacy. */
  private paletteSpec: PaletteSpec = "legacy";
  private grid: VoxelGrid | null = null;
  private bounds: VoxelBounds | null = null;

  /** True when the current session's `start` carried a `fourD` block — see
   * that field's doc. Set once per `start`; a restart (setPalette) never
   * toggles it, since a session's dimensionality doesn't change mid-life,
   * only a brand-new `start` can — mirrors flame-worker-core's `is4D`. */
  private is4D = false;
  private prepared4: PreparedChaosGame4 | null = null;
  /** The 20-coefficient rotor projection `composeRotorProjection4` builds —
   * created at `start` and rebuilt by `setFourDView`. Unlike the flame
   * session's `projection4` there is no camera to fold in here: the solid
   * render is world-space, so this alone is the projection. */
  private rotorProj4: RotorProjection4 | null = null;
  private fourDView: FourDView | null = null;
  /** Last settled rotor/view endpoint, retained for exact command
   * de-duplication and projection rebuilds around `fourDCenter`. */
  private fourDWorkerView: FourDWorkerView | null = null;
  /** Main-thread endpoint revision echoed on generation-bearing events. */
  private fourDViewRevision: number | undefined;
  /** Raw authored block retained for plan resolution at start/symmetry. */
  private tilingSpec: TilingSpec | null = null;
  private balloonEchoEnabled = false;
  private pointTilingPlan: PointTilingPlan | null = null;
  private pointTilingOriginRadius: number | null = null;
  /** Settled-view deposition policy reused by every worker chunk. */
  private preparedVoxelPointTiling4: PreparedVoxelPointTiling4 | null = null;
  private fourDColorMode: FourDColorMode = "wBlueOrange";
  /** Entry/source color centre, never replaced by tiling's origin pivot. */
  private fourDColorCenter: Vec4 = [0, 0, 0, 0];
  private fourDColorHalfExtents: Vec4 = [0, 0, 0, 0];
  /** Entry geometry frame. Active tiling may intentionally seed this as the
   * origin/carrier so a later in-worker refusal preserves the frozen view. */
  private fourDEntryCenter: Vec4 = [0, 0, 0, 0];
  private fourDEntryCarrierRadius: number | null = null;
  private fourDCenter: Vec4 = [0, 0, 0, 0];
  /** The active entry cloud's axis-aligned support, paired with
   * `fourDCenter` and deliberately unchanged by live document edits. */
  private fourDHalfExtents: Vec4 = [0, 0, 0, 0];
  private fourDRadiusMin = 0;
  private fourDRadiusMax = 1;
  private fourDColorGamma = 1;
  private fourDRampPalette: PaletteSpec = "legacy";
  private fourDPositionAxisColors: PositionAxisColors | undefined;
  /** Built once per `startAccumulation` (never per chunk — see
   * `buildFourDColor`) from the current `colorLUT` and the `fourD` block's
   * `colorMode`. `null` for a 3D session. */
  private fourDColor: FourDRenderColor | null = null;

  /** The raw (un-rotated) transforms/finalTransform from the last "start" —
   * retained so setSymmetry can re-prepare with a NEW symmetry without the
   * main thread resending the whole transform list. */
  private baseTransforms: Transform[] = [];
  /** The session's scheduled-hybrid post-word block (document form, both
   * dimensions), retained like `baseTransforms` so a symmetry restart
   * re-prepares with it — the flame session's field, verbatim. */
  private hybridSchedule: HybridSchedule | null = null;
  private baseFinalTransform: Transform | null = null;
  /** The raw 4D transform set from the last "start"'s `fourD` block —
   * retained for the same reason as the 3D pair above: setSymmetry re-runs
   * `prepareChaosGame4` over it with the NEW symmetry. Empty for a
   * 3D session. */
  private baseTransforms4: Transform4[] = [];
  private baseFinalTransform4: Transform4 | null = null;
  /** The symmetry actually baked into `this.prepared` (or, in a 4D session,
   * `this.prepared4`) right now — lets setSymmetry no-op a repeat value
   * instead of restarting for nothing (the order slider fires "input"
   * continuously while dragging, and can report the same integer step's value
   * more than once in a row). */
  private symmetryOrder = 1;
  private symmetryPlane: SymmetryPlane = "xz";
  /** The second angle of a 4D double rotation — 0 for every 3D
   * session, which cannot express one. */
  private symmetryTwist = 0;

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
    this.textureData = deps.textureData ?? voxelTextureData;
    this.buildHierarchy = deps.buildHierarchy ?? buildVoxelMaxHierarchy;
    this.computeBounds4 = deps.computeBounds4 ?? computeVoxelBounds4;
    this.accumulate4 = deps.accumulate4 ?? accumulateVoxels4;
    this.defaultMaxBytes = deps.maxBytes ?? VOXEL_ACCUM_FLOOR_BYTES;
    this.maxBytes = this.defaultMaxBytes;
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
          // already final — only the label's target is now stale.
          // Send just the counters; see the `progress` event's doc for why
          // not the (heavy) full grid.
          this.emit({
            type: "progress",
            iterationsDone: this.iterationsDone,
            iterationsBudget: this.iterationsBudget,
            ...(this.fourDViewRevision === undefined
              ? {}
              : { viewRevision: this.fourDViewRevision }),
          });
        } else if (this.grid) {
          // Lowered to/below the accumulated count mid-render: that finishes
          // the render on the spot, but no chunk will run to say so — the
          // already-scheduled one bails silently in runChunk — so the label
          // would freeze at its last value and the display would
          // miss whatever accumulated since the last throttled pack. Send
          // the final grid (fresh counters included) here.
          this.sendGrid(this.grid);
        }
        break;
      }
      case "setPalette":
        this.setPalette(command.palette);
        break;
      case "setColorInputs":
        this.setColorInputs(command.inputs);
        break;
      case "setFourDView":
        this.setFourDView(command.view, command.viewRevision);
        break;
      case "setSymmetry":
        this.setSymmetry(command.order, command.plane, command.twist ?? 0);
        break;
    }
  }

  /** The session's live kaleidoscope as the one object every consumer wants
   * — mirrors flame-worker-core's own `symmetry()`. */
  private symmetry(): SymmetryParams {
    return {
      order: this.symmetryOrder,
      plane: this.symmetryPlane,
      twist: this.symmetryTwist,
    };
  }

  /** {@link symmetry} as the 3D `prepareChaosGame` can express it — see
   * flame-worker-core's `symmetry3D` for the full argument (a 4D
   * kaleidoscope has no 3D expansion, and `symmetryRotation` throws on a
   * w-plane rather than degrade). */
  private symmetry3D(): SymmetryParams {
    const symmetry = this.symmetry();
    return symmetryIsNonFlat(symmetry)
      ? { order: 1, plane: symmetry.plane }
      : symmetry;
  }

  /** Resolve the raw authored block inside the worker realm. Typed-array
   * plans never cross postMessage, and resolution precedes RNG construction
   * on `start`. Flat Solid deliberately leaves its canonical worker volume
   * untouched because its live material owns the 3D fold. */
  private resolvePointTiling(): void {
    if (!this.is4D) {
      this.pointTilingPlan = null;
      this.pointTilingOriginRadius = null;
      this.preparedVoxelPointTiling4 = null;
      return;
    }
    const resolution = resolvePointTilingSession(
      this.baseTransforms,
      this.baseFinalTransform,
      this.symmetry(),
      this.hybridSchedule,
      this.tilingSpec,
      this.balloonEchoEnabled,
      true,
    );
    this.pointTilingPlan =
      resolution.status === "active" ? resolution.plan : null;
    this.pointTilingOriginRadius =
      resolution.status === "active" ? resolution.originVisibleRadius : null;
  }

  /**
   * Apply the dimensional-reduction policy for the current settled endpoint.
   * Active tiling rotates about the origin and normalizes signed-w by the
   * rotation-invariant carrier. Off/refused sessions restore the exact entry
   * centre/support. A lattice's pose-dependent proposal is built here once,
   * never in the chunk loop.
   */
  private applyPointTilingViewPolicy(): void {
    if (!this.is4D || this.fourDWorkerView === null) return;
    const planRadius =
      this.pointTilingPlan === null || this.pointTilingOriginRadius === null
        ? null
        : this.pointTilingPlan.kind === "lattice"
          ? this.pointTilingPlan.tiling.presentation.outerRadius
          : this.pointTilingOriginRadius;
    const normalizationRadius = planRadius ?? this.fourDEntryCarrierRadius;
    this.fourDCenter =
      planRadius === null ? [...this.fourDEntryCenter] : [0, 0, 0, 0];
    this.rotorProj4 = composeRotorProjection4(
      this.fourDWorkerView.rotor,
      this.fourDCenter,
    );
    this.fourDView = {
      invWAmp:
        normalizationRadius === null
          ? 1 /
            Math.max(
              wSupport(this.fourDWorkerView.rotor, this.fourDHalfExtents),
              1e-6,
            )
          : 1 / Math.max(normalizationRadius, 1e-6),
      sliceOn: this.fourDWorkerView.sliceOn,
      sliceCenter: this.fourDWorkerView.sliceCenter,
      sliceWidth: this.fourDWorkerView.sliceWidth,
      sliceRelativeColor: this.fourDWorkerView.sliceRelativeColor,
    };
    this.preparedVoxelPointTiling4 =
      this.pointTilingPlan === null || this.pointTilingOriginRadius === null
        ? null
        : prepareVoxelPointTiling4(
            this.pointTilingPlan,
            this.pointTilingOriginRadius,
            this.rotorProj4,
            this.fourDView,
          );
  }

  private start(cmd: Extract<VoxelWorkerCommand, { type: "start" }>): void {
    installStartMeshAssets(cmd.meshAssets);
    this.hierarchyEnabled = true;

    this.baseTransforms = cmd.transforms;
    this.baseFinalTransform = cmd.finalTransform;
    this.hybridSchedule = cmd.schedule ?? null;
    this.tilingSpec = cmd.tiling ?? null;
    this.balloonEchoEnabled = cmd.balloonEchoEnabled ?? false;
    this.symmetryOrder = cmd.order;
    this.symmetryPlane = cmd.plane;
    this.symmetryTwist = cmd.twist ?? 0;
    // Built unconditionally, mirroring flame-worker-core's own `start`: even
    // in a 4D session these still arrive (the main thread always sends
    // both) but are simply unused. See `symmetry3D` for the
    // 4D-kaleidoscope case.
    this.prepared = prepareChaosGame(
      cmd.transforms,
      cmd.finalTransform,
      this.symmetry3D(),
      this.hybridSchedule,
    );
    this.palette = transformColors(
      cmd.transforms.length,
      cmd.transforms.map((t) => t.colorIndex),
    );
    this.colorMode = cmd.colorMode;
    this.positionAxisColors = cmd.positionAxisColors;
    this.colorGamma = cmd.colorGamma;
    this.rampPalette = cmd.rampPalette;
    // null for "legacy" — accumulateVoxels/buildFourDColor then falls back
    // to colorMode/the explorer's 4D color mode respectively.
    this.colorLUT = buildPaletteLUT(cmd.palette);
    this.paletteSpec = cmd.palette;
    this.iterationsBudget = cmd.iterationsBudget;
    this.requestedResolution = cmd.resolution;
    this.maxBytes = cmd.maxBytes ?? this.defaultMaxBytes;
    this.maxSafeResolution = Infinity; // a fresh session has no learned ceiling yet.
    this.fourDViewRevision = undefined;

    this.is4D = cmd.fourD !== undefined;
    if (cmd.fourD) {
      const fourD = cmd.fourD;
      this.baseTransforms4 = fourD.transforms4;
      this.baseFinalTransform4 = fourD.finalTransform4;
      this.prepared4 = prepareChaosGame4(
        fourD.transforms4,
        fourD.finalTransform4,
        this.symmetry(),
        this.hybridSchedule,
      );
      // Initial world-space rotor projection. `setFourDView` may replace it
      // after a settled manual edit; there is no camera to fold on top.
      this.rotorProj4 = composeRotorProjection4(fourD.rotor, fourD.center);
      this.fourDView = {
        invWAmp: fourD.invWAmp,
        sliceOn: fourD.sliceOn,
        sliceCenter: fourD.sliceCenter,
        sliceWidth: fourD.sliceWidth,
        sliceRelativeColor: fourD.sliceRelativeColor,
      };
      this.fourDWorkerView = {
        rotor: [...fourD.rotor],
        sliceOn: fourD.sliceOn,
        sliceCenter: fourD.sliceCenter,
        sliceWidth: fourD.sliceWidth,
        sliceRelativeColor: fourD.sliceRelativeColor,
      };
      this.fourDColorMode = fourD.colorMode;
      this.fourDEntryCenter = [...fourD.center];
      this.fourDEntryCarrierRadius =
        fourD.entryCarrierRadius !== undefined &&
        Number.isFinite(fourD.entryCarrierRadius) &&
        fourD.entryCarrierRadius > 0
          ? fourD.entryCarrierRadius
          : null;
      this.fourDColorCenter = [...(fourD.colorCenter ?? fourD.center)];
      this.fourDColorHalfExtents = [
        ...(fourD.colorHalfExtents ?? fourD.halfExtents),
      ];
      this.fourDCenter = [...fourD.center];
      this.fourDHalfExtents = [...fourD.halfExtents];
      this.fourDRadiusMin = fourD.radiusMin;
      this.fourDRadiusMax = fourD.radiusMax;
      this.fourDColorGamma = fourD.colorGamma ?? 1;
      this.fourDRampPalette = fourD.rampPalette;
      this.fourDPositionAxisColors = fourD.positionAxisColors;
    } else {
      this.baseTransforms4 = [];
      this.baseFinalTransform4 = null;
      this.prepared4 = null;
      this.rotorProj4 = null;
      this.fourDView = null;
      this.fourDWorkerView = null;
      this.fourDEntryCenter = [0, 0, 0, 0];
      this.fourDEntryCarrierRadius = null;
      this.fourDColorCenter = [0, 0, 0, 0];
      this.fourDColorHalfExtents = [0, 0, 0, 0];
      this.fourDCenter = [0, 0, 0, 0];
      this.fourDHalfExtents = [0, 0, 0, 0];
    }

    // Resolve and prepare worker-local tiling before constructing the seeded
    // stream. The resolver's fixed probe has its own RNG and cannot perturb
    // the chaos orbit; absent/refused keeps the literal historical path.
    this.resolvePointTiling();
    this.applyPointTilingViewPolicy();
    this.rng = mulberry32(cmd.seed);

    // The untiled bounds pilot is part of the same seeded run. Active tiling
    // instead selects the exact certified carrier cube and consumes no orbit
    // draws before accumulation.
    this.bounds = this.is4D
      ? this.computeBounds4(
          this.prepared4!,
          this.rotorProj4!,
          this.fourDView!,
          this.rng,
          this.boundsSamples,
          this.preparedVoxelPointTiling4 ?? undefined,
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
          // BASE maps, not the symmetry-EXPANDED slot count:
          // `accumulateVoxels4` indexes this by `idx % baseTransformCount`,
          // so every kaleidoscope copy takes the color of the map it copies
          // — and the hues stay put when the kaleidoscope's order changes.
          // colorIndexes come from the same `baseTransforms4` the
          // structural walk already resolves its own colorIndex/colorSpeed
          // pair from — no second wire channel needed.
          palette: transformColors(
            this.prepared4?.baseTransformCount ?? 0,
            this.baseTransforms4.map((t) => t.colorIndex),
          ),
        };
      case "height":
        return {
          kind: "height",
          lut: buildColorModeLUT(
            "height",
            this.fourDColorGamma,
            this.fourDRampPalette,
          ),
          minY: this.fourDColorCenter[1] - this.fourDColorHalfExtents[1],
          maxY: this.fourDColorCenter[1] + this.fourDColorHalfExtents[1],
        };
      case "radius":
        return {
          kind: "radius",
          lut: buildColorModeLUT(
            "radius",
            this.fourDColorGamma,
            this.fourDRampPalette,
          ),
          center: this.fourDColorCenter,
          minD: this.fourDRadiusMin,
          maxD: this.fourDRadiusMax,
        };
      case "position":
        return {
          kind: "position",
          min: [
            this.fourDColorCenter[0] - this.fourDColorHalfExtents[0],
            this.fourDColorCenter[1] - this.fourDColorHalfExtents[1],
            this.fourDColorCenter[2] - this.fourDColorHalfExtents[2],
          ],
          max: [
            this.fourDColorCenter[0] + this.fourDColorHalfExtents[0],
            this.fourDColorCenter[1] + this.fourDColorHalfExtents[1],
            this.fourDColorCenter[2] + this.fourDColorHalfExtents[2],
          ],
          colorGamma: this.fourDColorGamma,
          axisColors: this.fourDPositionAxisColors,
        };
      case "uniform":
        return { kind: "uniform", color: UNIFORM_POINT_COLOR };
    }
  }

  /**
   * Live palette change (mirroring the flame session's `setPalette`):
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
    this.paletteSpec = palette;
    this.startAccumulation();
  }

  /**
   * Atomically stage every shared color input. A nonlegacy primary palette
   * overrides this whole path, so staging under it performs no work; a later
   * `setPalette("legacy")` restart reads these retained values. Under legacy,
   * the current dimension bakes the inputs into avgRGB, so restart only the
   * accumulation over the existing prepared geometry and frozen bounds.
   */
  private setColorInputs(inputs: RenderColorInputs): void {
    if (!this.hasGeometry()) return;
    const unchanged = this.is4D
      ? sameFourDRenderColorInputs(
          {
            colorMode: this.fourDColorMode,
            colorGamma: this.fourDColorGamma,
            rampPalette: this.fourDRampPalette,
            positionAxisColors: this.fourDPositionAxisColors,
          },
          inputs.fourD,
        )
      : sameFlatRenderColorInputs(
          {
            colorMode: this.colorMode,
            colorGamma: this.colorGamma,
            rampPalette: this.rampPalette,
            positionAxisColors: this.positionAxisColors,
          },
          inputs.flat,
        );
    this.colorMode = inputs.flat.colorMode;
    this.colorGamma = inputs.flat.colorGamma;
    this.rampPalette = inputs.flat.rampPalette;
    this.positionAxisColors = inputs.flat.positionAxisColors;
    this.fourDColorMode = inputs.fourD.colorMode;
    this.fourDColorGamma = inputs.fourD.colorGamma ?? 1;
    this.fourDRampPalette = inputs.fourD.rampPalette;
    this.fourDPositionAxisColors = inputs.fourD.positionAxisColors;
    if (this.paletteSpec !== "legacy" || unchanged) return;
    this.startAccumulation();
  }

  /**
   * Apply one settled manual 4D pose edit to the active solid. Rotor, slice
   * weights and active Classic W-ramp colors are baked into the voxel grid,
   * and a rotor/slice can change the projected extent, so every spatial
   * endpoint change rebuilds both the projection/view and the bounds pilot
   * before the ordinary accumulation restart. An inert slice-relative-color
   * endpoint is staged until the color path consumes it. The entry centre
   * remains session-owned; signed-w normalization is recomputed here from the
   * retained entry support rather than trusted to the caller's current
   * document.
   */
  private setFourDView(view: FourDWorkerView, viewRevision?: number): void {
    if (
      !this.is4D ||
      !this.hasGeometry() ||
      this.fourDWorkerView === null ||
      sameFourDWorkerView(this.fourDWorkerView, view)
    ) {
      return;
    }

    const relativeColorOnly = sameFourDWorkerSpatialView(
      this.fourDWorkerView,
      view,
    );
    const needsRebuild = fourDWorkerViewNeedsRebuild(
      this.fourDWorkerView,
      view,
      this.paletteSpec === "legacy" &&
        !fourDColorNeedsAttribute(this.fourDColorMode),
    );
    this.fourDWorkerView = { ...view, rotor: [...view.rotor] };
    this.fourDViewRevision = viewRevision;
    if (relativeColorOnly) {
      this.fourDView = {
        ...this.fourDView!,
        sliceRelativeColor: view.sliceRelativeColor,
      };
      // Structural coloring and the attribute modes do not consume the
      // W-ramp remap. Stage it for a later Classic W-ramp restart without
      // discarding the current grid or re-piloting unchanged bounds.
      if (!needsRebuild) return;
      this.startAccumulation();
      return;
    }

    this.applyPointTilingViewPolicy();
    this.bounds = this.computeBounds4(
      this.prepared4!,
      this.rotorProj4!,
      this.fourDView!,
      this.rng,
      this.boundsSamples,
      this.preparedVoxelPointTiling4 ?? undefined,
    );
    this.startAccumulation();
  }

  /** Live kaleidoscope change. Both dimensions rebuild their own prepared
   * game (the 4D path has `postRotations`/base-map bookkeeping of its
   * own, so this is no longer 3D-only), re-pilot their bounds, and
   * restart the accumulation — mirrors flame-worker-core's own
   * `setSymmetry`, plus the bounds pass the flame has no counterpart for. */
  private setSymmetry(
    order: number,
    plane: SymmetryPlane,
    twist: number,
  ): void {
    if (!this.hasGeometry()) return; // no active session yet.
    if (
      order === this.symmetryOrder &&
      plane === this.symmetryPlane &&
      twist === this.symmetryTwist
    ) {
      return;
    }
    this.symmetryOrder = order;
    this.symmetryPlane = plane;
    this.symmetryTwist = twist;
    if (this.is4D) {
      this.prepared4 = prepareChaosGame4(
        this.baseTransforms4,
        this.baseFinalTransform4,
        this.symmetry(),
        this.hybridSchedule,
      );
    } else {
      this.prepared = prepareChaosGame(
        this.baseTransforms,
        this.baseFinalTransform,
        this.symmetry3D(),
        this.hybridSchedule,
      );
    }
    this.resolvePointTiling();
    this.applyPointTilingViewPolicy();
    // Symmetry changes the attractor's spatial extent — a kaleidoscope can be
    // considerably wider than the base system — so the bounds pilot has to
    // rerun too, not just the accumulation (unlike setIterationsBudget above,
    // which never touches geometry). Reuses `this.rng` where it currently
    // sits, same as `start()` uses it fresh — a restart was never meant to be
    // bit-for-bit replayable against the original seed, only internally
    // consistent from here on. The 4D pilot is the same one `start` runs,
    // through the current rotor/view (a 4D kaleidoscope widens the PROJECTED
    // cloud exactly as a 3D one widens the raw attractor).
    this.bounds = this.is4D
      ? this.computeBounds4(
          this.prepared4!,
          this.rotorProj4!,
          this.fourDView!,
          this.rng,
          this.boundsSamples,
          this.preparedVoxelPointTiling4 ?? undefined,
        )
      : computeVoxelBounds(this.prepared!, this.rng, this.boundsSamples);
    this.startAccumulation();
  }

  /**
   * (Re)allocate the grid at the largest resolution the budget (and any
   * learned allocation ceiling) allows, and start accumulating. On a real
   * allocation failure, learn the ceiling and retry one step smaller rather
   * than failing every attempt forever — the reactive guard backing up the
   * proactive exact-memory estimate, mirroring the flame session's
   * supersample fallback. Dimension-agnostic: the grid itself (and this OOM
   * guard) doesn't care whether it's being filled by the 3D or 4D path. The
   * ONE place that actually discards a prior accumulation (shared by
   * `start`, a live `setPalette`/`setFourDView`/`setSymmetry`/
   * `setColorInputs`, and the OOM retry above), so
   * it's also where the `restarted` event is emitted — but only
   * once the grid is actually (re)allocated, i.e. never for a failed attempt
   * that's about to retry smaller.
   */
  private startAccumulation(): void {
    if (!this.bounds) return;
    const effective = Math.min(
      clampVoxelResolutionToMemoryBudget(
        this.requestedResolution,
        this.maxBytes,
      ),
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
    // Tell the main thread right now, not on the next grid pack (see the
    // `restarted` event's doc) — emitted unconditionally, including from
    // `start`'s own call into this method, which keeps this the one place
    // that announces a discard rather than special-casing the first one.
    this.emit({
      type: "restarted",
      iterationsBudget: this.iterationsBudget,
      ...(this.fourDViewRevision === undefined
        ? {}
        : { viewRevision: this.fourDViewRevision }),
    });
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
      this.accumulate4(
        this.prepared4!,
        grid,
        chunk,
        this.rng,
        this.rotorProj4!,
        this.fourDView!,
        this.fourDColor!,
        this.preparedVoxelPointTiling4 ?? undefined,
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
      texture = this.textureData(grid);
    } catch (e) {
      this.emit({ type: "error", message: describeError(e) });
      return false;
    }
    let hierarchy: VoxelWorkerHierarchyPayload = { status: "absent" };
    if (this.hierarchyEnabled) {
      try {
        const built: VoxelMaxHierarchy = this.buildHierarchy(
          texture,
          this.effectiveResolution,
        );
        hierarchy = { status: "present", ...built };
      } catch {
        // The texture was already packed successfully and remains the
        // complete legacy render path. Latch acceleration off so subsequent
        // progressive packs do not repeat the same allocation pressure.
        this.hierarchyEnabled = false;
      }
    }
    this.emit({
      type: "grid",
      texture,
      hierarchy,
      size: this.effectiveResolution,
      boundsMin: grid.bounds.min,
      boundsMax: grid.bounds.max,
      iterationsDone: this.iterationsDone,
      iterationsBudget: this.iterationsBudget,
      ...(this.fourDViewRevision === undefined
        ? {}
        : { viewRevision: this.fourDViewRevision }),
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
