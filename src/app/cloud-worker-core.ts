/**
 * The live point cloud's worker-side compute: one pure function from
 * a {@link CloudRequest} to a {@link CloudResult} — the chaos game
 * (`runChaosGame` / `runChaosGame4`, seeded) plus, on the 3D path, the baked
 * color buffer (`buildColors`), so a regeneration costs the main thread
 * nothing but a GPU upload. `cloud-worker.ts` is the thin
 * `self.onmessage`/`postMessage` glue that runs this inside the real Worker;
 * `cloud-generator.ts` is the main-thread client that posts requests (and
 * calls {@link generateCloud} directly as its synchronous fallback — the same
 * compute either way, which is what makes the fallback trustworthy).
 *
 * Unlike the flame/voxel worker cores there is no session state machine here:
 * a generation is a one-shot request → response (no chunking, no live
 * commands, no progress streaming). While a huge generation runs, the WORKER
 * is busy but the main thread stays interactive — the cloud is merely a
 * generation behind, which is the entire point (the synchronous
 * alternative was measured at a multi-hundred-ms main-thread stall per
 * drag frame at high point counts). The at-most-one-in-flight policy lives in
 * `cloud-generator.ts`, so this module never sees overlapping requests.
 */
import { runChaosGame, runChaosGameTiledPoints } from "../fractal/chaos-game";
import type { ChaosGameResult } from "../fractal/chaos-game";
import {
  runChaosGame4,
  runChaosGame4TiledPoints,
} from "../fractal/chaos-game-4d";
import type { ChaosGame4Result } from "../fractal/chaos-game-4d";
import { toTransform4 } from "../fractal/affine4";
import { buildColors } from "../fractal/color";
import type {
  PointColorSource3D,
  PointColorSource4D,
  PositionAxisColors,
} from "../fractal/color";
import { pointTilingStatus } from "../fractal/point-tiling";
import { resolvePointTilingSession } from "../fractal/point-tiling-session";
import { isResolvedLatticeTiling, type TilingSpec } from "../fractal/tiling";
import {
  latticeCameraCarrierRadius4,
  latticeCameraFitBounds,
} from "../fractal/lattice-march";
import type { PaletteSpec } from "../fractal/palette";
import {
  hasMeshAsset,
  installCustomMeshAsset,
  installSerializedCustomMeshAsset,
  MAX_CUSTOM_MESH_RUNTIME_ASSETS,
  prepareSerializedCustomMeshAsset,
  touchInstalledCustomMeshAssets,
  type CustomMeshAssetId,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import { iterationRng, mulberry32 } from "../fractal/rng";
import type {
  Bounds,
  ColorMode,
  HybridSchedule,
  SymmetryParams,
  Transform,
} from "../fractal/types";
import { framingBounds, framingRadius4 } from "./framing-bounds";
import type { PointTilingOutcome } from "./point-tiling-outcome";

/**
 * Main thread → worker: one point-cloud generation request. Everything the
 * generation is a pure function of, in main-thread (3D `Transform`) terms —
 * the 4D lift (`toTransform4`) happens worker-side so the wire payload stays
 * one shape for both paths.
 */
export interface CloudRequest {
  /** Monotonic tag stamped by `cloud-generator.ts` and echoed on the result,
   * so the client can match a reply to its request and drop stale ones. */
  id: number;
  /** Custom mesh cache-miss sources needed by this generation. Workers own a
   * separate module registry; persistent clients attach the complete active
   * ids below and only the structured-cloneable wires absent from that realm.
   * Synchronous callers attach the full set. */
  meshAssets?: readonly SerializedPreparedMeshAsset[];
  /** Complete active custom-mesh id set. The persistent worker uses it to
   * refresh resident entries before installing only the cache misses carried
   * by `meshAssets`; synchronous callers may omit it because their full wires
   * already carry the same set. */
  meshAssetIds?: readonly CustomMeshAssetId[];
  transforms: Transform[];
  finalTransform: Transform | null;
  numPoints: number;
  /** Explicit numeric seed (a live `Rng` can't cross postMessage) — same
   * discipline as the flame/voxel `start` commands. */
  seed: number;
  /** Kaleidoscope symmetry, 3D and 4D alike. Both paths honor it —
   * `runChaosGame4` rotates its copies in a PLANE (optionally a second,
   * orthogonal one, for a double rotation) where `runChaosGame` rotates about
   * an axis, and the two agree entry for entry wherever a system is flat. */
  symmetry: SymmetryParams;
  /** True → the system is non-flat: lift through `toTransform4` and run the
   * 4D chaos game. Decided by the MAIN thread (`systemIsNonFlat(state)`) so
   * the view-flip bookkeeping there and the generation here can't disagree. */
  fourD: boolean;
  /** The scheduled-hybrid post-word block (`types.ts`'s
   * {@link HybridSchedule}), in main-thread 3D terms for BOTH paths — the
   * 4D prepare lifts B worker-side exactly like the transforms themselves.
   * `null`/absent — every pre-feature document — runs both chaos games
   * byte-identically to before the field existed. */
  schedule: HybridSchedule | null;
  /** Raw, structured-clone-safe authored space-tiling block. The worker
   * resolves estimator radius, session clip pose and point-image tables in
   * its own module realm; resolved finite plans must never cross this wire. */
  tiling?: TilingSpec | null;
  /** Balloon is a presentation-level refusal for point tiling. It travels
   * with the request so a delayed result reports the policy it actually ran,
   * never whatever the live checkbox says when it arrives. */
  balloonEcho?: boolean;
  /** 3D color bake inputs (`buildColors`); unused on the 4D path, where color
   * is shader-owned or rebaked main-side per mode (see main.ts's
   * `applyFourDColor`). */
  colorMode: ColorMode;
  colorGamma: number;
  /**
   * Gradient palette for the height/radius color-mode ramps,
   * resolved by the MAIN thread (`resolvePalette` — the bare `"custom"`
   * sentinel has no payload to cross the wire with; see `palette.ts`'s
   * `PaletteSpec`), exactly like the flame/voxel start commands' `palette`.
   * `"legacy"` is the built-in ramps; inert for every other `colorMode`, and
   * on the 4D path like the rest of the color-bake inputs.
   */
  rampPalette: PaletteSpec;
  /** The position mode's custom axis colors — `buildColors`'
   * parameter of the same name; absent = the legacy XYZ→RGB mapping. Inert
   * for every other `colorMode`, and on the 4D path like the rest of the
   * color-bake inputs. */
  positionAxisColors?: PositionAxisColors;
  /**
   * Delivery metadata for the main thread's arrival handler — the worker
   * ignores both. `replaced` marks a whole-system replacement (preset load /
   * Surprise Me / snapshot restore), driving the "fresh visit" view resets;
   * `fit` asks the arrival handler to auto-frame the camera on this result.
   * When `cloud-generator.ts` coalesces a still-unsent request into a newer
   * one, these OR together — a superseded preset load's replacement-ness (and
   * its camera fit) must survive into the request that actually runs.
   */
  replaced: boolean;
  fit: boolean;
}

/** The 3D result: the chaos-game output plus the worker-baked color buffer. */
export interface CloudResult3D extends ChaosGameResult {
  id: number;
  fourD: false;
  /** `buildColors(...)` over this result at the REQUEST's colorMode/gamma —
   * shader-ready; main.ts recolors on arrival only if the mode changed while
   * this generation was in flight. */
  colors: Float32Array;
  /**
   * Outlier-robust box for the camera fit: per-axis trimmed
   * quantiles of the delivered cloud (`framing-bounds.ts`), baked worker-side
   * like `colors`. The camera fit/chase frames THIS; `bounds` stays the true
   * min/max extent, which color normalization and the glow-exposure estimate
   * still read.
   */
  frameBounds: Bounds;
  /** Active tiled clouds retain the canonical post-schedule/post-lens source
   * aligned to every emitted image so live structural recolor stays attached
   * to the source rather than the replicated carrier. */
  canonicalColorSource?: PointColorSource3D;
  /** Present only when the request authored tiling (active or refused). */
  pointTiling?: PointTilingOutcome;
}

/** The 4D result: the 4D chaos-game output as-is. No baked colors — the 4D
 * projection's color is shader-owned (w-ramp modes) or rebaked main-side per
 * mode over the cached result (see main.ts's `applyFourDColor`), exactly as
 * it was under the synchronous path. */
export interface CloudResult4D extends ChaosGame4Result {
  id: number;
  fourD: true;
  /**
   * Outlier-robust framing radius for the camera fit: a trimmed
   * quantile of the 4D distance-from-`center` (`framing-bounds.ts`), still
   * rotation-invariant because the tumble rotates about `center` itself.
   * The fit frames this ball; the EXACT `radius` keeps feeding the frustum
   * culling sphere and w-color normalization, which must cover every point.
   */
  frameRadius: number;
  canonicalColorSource?: PointColorSource4D;
  pointTiling?: PointTilingOutcome;
}

/** Worker → main thread: the generated cloud, tagged with the request's id. */
export type CloudResult = CloudResult3D | CloudResult4D;

/** Hard worker-wire ceiling for active tiled color provenance. At the
 * authored 5M-point maximum the larger 4D source is exactly 80 MB; 3D is
 * 60 MB. This is intentionally the provenance increment, not a claim about
 * the cloud result's complete resident size. */
export const MAX_CANONICAL_COLOR_SOURCE_BYTES = 80_000_000;

/**
 * Extra resident/transfer storage retained only for an active tiled cloud's
 * canonical color provenance. The source is aligned one-for-one with the
 * delivered carrier, so its upper bound is a pure multiple of the authored
 * output capacity: xyz f32 in 3D, xyz+w f32 in 4D. Keeping this calculation
 * explicit lets the worker integration gate the 5M-point document ceiling
 * without allocating a maximum-sized cloud in a unit test.
 */
export function canonicalColorSourceByteCeiling(
  pointCapacity: number,
  fourD: boolean,
): number {
  if (!Number.isSafeInteger(pointCapacity) || pointCapacity < 0) {
    throw new RangeError(
      "canonical color source capacity must be a non-negative safe integer",
    );
  }
  const bytes =
    pointCapacity * Float32Array.BYTES_PER_ELEMENT * (fourD ? 4 : 3);
  if (!Number.isSafeInteger(bytes)) {
    throw new RangeError("canonical color source byte ceiling is unsafe");
  }
  return bytes;
}

/**
 * XOR'd into `request.seed` to derive the iteration-local stream's own seed
 * (the golden-ratio constant, but any fixed value works —
 * `mulberry32`'s mixing decorrelates any two distinct seeds). One derivation
 * for the 3D and 4D paths, so a flat↔4D morph's alternating requests keep
 * one discipline.
 */
const ITERATION_SEED_XOR = 0x9e3779b9;

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

function installRequestMeshAssets(
  wires: readonly SerializedPreparedMeshAsset[] = [],
  activeIds: readonly CustomMeshAssetId[] = wires.map((wire) => wire.id),
): void {
  if (
    wires.length > MAX_CUSTOM_MESH_RUNTIME_ASSETS ||
    activeIds.length > MAX_CUSTOM_MESH_RUNTIME_ASSETS ||
    new Set([...activeIds, ...wires.map((wire) => wire.id)]).size >
      MAX_CUSTOM_MESH_RUNTIME_ASSETS
  ) {
    throw new RangeError("too many custom mesh sources in request");
  }
  for (let index = 0; index < wires.length; index += 1) {
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (
        wires[earlier].id === wires[index].id &&
        !sameMeshSource(wires[earlier], wires[index])
      ) {
        throw new RangeError("serialized mesh conflicts within request");
      }
    }
  }
  touchInstalledCustomMeshAssets(activeIds);
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

/**
 * Run one point-cloud generation — the pure request → result function both
 * the real worker (`cloud-worker.ts`) and the main-thread synchronous
 * fallback (`cloud-generator.ts`) execute. Seeded via `mulberry32`, so a
 * given request reproduces exactly, wherever it runs.
 *
 * Iteration-local randomness — a stochastic variation's coin flips, the
 * escape-reseed coordinates — draws from a per-iteration stream derived from
 * the same request seed ({@link ITERATION_SEED_XOR}; see `rng.ts`'s
 * `iterationRng`). Still a pure function of the request, but the primary
 * pick stream's consumption becomes rigid (one draw per pick), and each
 * iteration's dice are its own. That keeps the morph's pinned-seed point
 * correspondence intact across ε-different samples: on one shared
 * stream, a single differing escape — or a weight-boundary pick flip landing
 * on a `julia`-carrying map in one sample only — shifted every subsequent
 * transform pick and re-rolled the entire remaining cloud; the morph
 * visibly boiled.
 */
export function generateCloud(request: CloudRequest): CloudResult {
  // Guard the raw authored wire before mesh installation, session fitting,
  // RNG construction or any output-capacity typed arrays. Main-thread state
  // already clamps authored points to 5M; this makes that memory invariant
  // independently executable in the worker/fallback boundary.
  if (request.tiling) {
    const canonicalBytes = canonicalColorSourceByteCeiling(
      request.numPoints,
      request.fourD,
    );
    if (canonicalBytes > MAX_CANONICAL_COLOR_SOURCE_BYTES) {
      throw new RangeError(
        `canonical color source requires ${canonicalBytes} bytes, exceeding the ${MAX_CANONICAL_COLOR_SOURCE_BYTES}-byte worker ceiling`,
      );
    }
  }

  installRequestMeshAssets(request.meshAssets, request.meshAssetIds);

  // Resolve legality and the worker-local matrix/CDF plan before constructing
  // either request-seeded stream. The clip-fit probes use their own fixed
  // seed, so neither a legal plan nor a refusal can perturb the ordinary
  // orbit's primary/auxiliary RNG contract.
  const pointTiling = resolvePointTilingSession(
    request.transforms,
    request.finalTransform,
    request.symmetry,
    request.schedule,
    request.tiling ?? null,
    request.balloonEcho ?? false,
    request.fourD,
  );

  if (pointTiling.status === "active") {
    const rng = mulberry32(request.seed);
    const iterRng = iterationRng(request.seed ^ ITERATION_SEED_XOR);
    if (request.fourD) {
      const transforms4 = request.transforms.map(toTransform4);
      const final4 = request.finalTransform
        ? toTransform4(request.finalTransform)
        : null;
      const result = runChaosGame4TiledPoints(
        transforms4,
        request.numPoints,
        pointTiling.plan,
        rng,
        final4,
        request.symmetry,
        iterRng,
        request.schedule,
      );
      const canonicalColorSource: PointColorSource4D = {
        positions: result.canonicalPositions,
        w: result.canonicalW,
        bounds: result.canonicalBounds,
        center: result.canonicalCenter,
      };
      const frameRadius = isResolvedLatticeTiling(pointTiling.resolved)
        ? latticeCameraCarrierRadius4(
            pointTiling.resolved.h,
            pointTiling.resolved.radius,
          )
        : framingRadius4(
            result.positions,
            result.w,
            result.count,
            result.center,
          );
      const outcome: PointTilingOutcome = {
        availability: "active",
        kind: pointTiling.plan.kind,
        fill: pointTilingStatus(request.numPoints, result.count),
        requested: request.numPoints,
        attempts: result.pointTilingState.attempts,
        accepted: result.pointTilingState.accepted,
        candidateTests: result.pointTilingState.candidateTests,
      };
      const {
        canonicalPositions: _canonicalPositions,
        canonicalW: _canonicalW,
        canonicalBounds: _canonicalBounds,
        canonicalCenter: _canonicalCenter,
        pointTilingState: _pointTilingState,
        ...cloud
      } = result;
      return {
        id: request.id,
        fourD: true,
        ...cloud,
        frameRadius,
        canonicalColorSource,
        pointTiling: outcome,
      };
    }

    const result = runChaosGameTiledPoints(
      request.transforms,
      request.numPoints,
      pointTiling.plan,
      rng,
      request.finalTransform,
      request.symmetry,
      iterRng,
      request.schedule,
    );
    const canonicalColorSource: PointColorSource3D = {
      positions: result.canonicalPositions,
      bounds: result.canonicalBounds,
    };
    const colors = buildColors(
      result,
      request.transforms,
      request.colorMode,
      request.colorGamma,
      request.rampPalette,
      request.positionAxisColors,
      canonicalColorSource,
    );
    const frameBounds = isResolvedLatticeTiling(pointTiling.resolved)
      ? latticeCameraFitBounds(
          pointTiling.resolved.h,
          pointTiling.resolved.radius,
          false,
        )
      : framingBounds(result.positions, result.count);
    const outcome: PointTilingOutcome = {
      availability: "active",
      kind: pointTiling.plan.kind,
      fill: pointTilingStatus(request.numPoints, result.count),
      requested: request.numPoints,
      attempts: result.pointTilingState.attempts,
      accepted: result.pointTilingState.accepted,
      candidateTests: result.pointTilingState.candidateTests,
    };
    const {
      canonicalPositions: _canonicalPositions,
      canonicalBounds: _canonicalBounds,
      pointTilingState: _pointTilingState,
      ...cloud
    } = result;
    return {
      id: request.id,
      fourD: false,
      ...cloud,
      colors,
      frameBounds,
      canonicalColorSource,
      pointTiling: outcome,
    };
  }

  // The classic/refused arm below is deliberately the historical generation
  // path: same calls, arrays and RNG construction. A refusal adds only
  // request-associated disclosure metadata; it never substitutes a tiled
  // empty/underfilled result, because those return from the active arm above.
  const refusedOutcome: PointTilingOutcome | undefined =
    pointTiling.status === "refused"
      ? { availability: "refused", note: pointTiling.note }
      : undefined;
  const rng = mulberry32(request.seed);
  const iterRng = iterationRng(request.seed ^ ITERATION_SEED_XOR);
  if (request.fourD) {
    const transforms4 = request.transforms.map(toTransform4);
    const final4 = request.finalTransform
      ? toTransform4(request.finalTransform)
      : null;
    const result = runChaosGame4(
      transforms4,
      request.numPoints,
      rng,
      final4,
      request.symmetry,
      iterRng,
      request.schedule,
    );
    const frameRadius = framingRadius4(
      result.positions,
      result.w,
      result.count,
      result.center,
    );
    return {
      id: request.id,
      fourD: true,
      ...result,
      frameRadius,
      ...(refusedOutcome ? { pointTiling: refusedOutcome } : {}),
    };
  }
  const result = runChaosGame(
    request.transforms,
    request.numPoints,
    rng,
    request.finalTransform,
    request.symmetry,
    iterRng,
    request.schedule,
  );
  const colors = buildColors(
    result,
    request.transforms,
    request.colorMode,
    request.colorGamma,
    request.rampPalette,
    request.positionAxisColors,
  );
  const frameBounds = framingBounds(result.positions, result.count);
  return {
    id: request.id,
    fourD: false,
    ...result,
    colors,
    frameBounds,
    ...(refusedOutcome ? { pointTiling: refusedOutcome } : {}),
  };
}

/**
 * The buffers to move (zero-copy ownership transfer, not clone) when posting
 * `result` to the main thread — every per-point array it carries. Each is a
 * fresh standalone allocation per generation (see `runChaosGame` /
 * `runChaosGame4` / `buildColors`), so transferring never detaches memory
 * anything else still holds a view of.
 *
 * The casts narrow the fractal core's loose `ArrayBufferLike` buffer typing:
 * those functions only ever allocate plain `ArrayBuffer`s (`new
 * Float32Array(n)`), never SharedArrayBuffer-backed views.
 */
export function cloudResultTransfers(result: CloudResult): ArrayBuffer[] {
  const transfers = [
    result.positions.buffer as ArrayBuffer,
    result.transformIndices.buffer as ArrayBuffer,
  ];
  if (result.fourD) {
    transfers.push(result.w.buffer as ArrayBuffer);
    if (result.canonicalColorSource) {
      transfers.push(
        result.canonicalColorSource.positions.buffer as ArrayBuffer,
        result.canonicalColorSource.w.buffer as ArrayBuffer,
      );
    }
  } else {
    transfers.push(result.colors.buffer as ArrayBuffer);
    if (result.canonicalColorSource) {
      transfers.push(
        result.canonicalColorSource.positions.buffer as ArrayBuffer,
      );
    }
  }
  return transfers;
}
