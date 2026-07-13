/**
 * The live point cloud's worker-side compute (fr-5kx): one pure function from
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
 * generation behind, which is the entire point (fr-acc measured the
 * synchronous alternative: a multi-hundred-ms main-thread stall per drag
 * frame at high point counts). The at-most-one-in-flight policy lives in
 * `cloud-generator.ts`, so this module never sees overlapping requests.
 */
import { runChaosGame } from "../fractal/chaos-game";
import type { ChaosGameResult } from "../fractal/chaos-game";
import { runChaosGame4 } from "../fractal/chaos-game-4d";
import type { ChaosGame4Result } from "../fractal/chaos-game-4d";
import { toTransform4 } from "../fractal/affine4";
import { buildColors } from "../fractal/color";
import type { PositionAxisColors } from "../fractal/color";
import type { PaletteSpec } from "../fractal/palette";
import { iterationRng, mulberry32 } from "../fractal/rng";
import type { ColorMode, SymmetryParams, Transform } from "../fractal/types";

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
  transforms: Transform[];
  finalTransform: Transform | null;
  numPoints: number;
  /** Explicit numeric seed (a live `Rng` can't cross postMessage) — same
   * discipline as the flame/voxel `start` commands. */
  seed: number;
  /** Kaleidoscope symmetry (fr-6im). 3D-only by design — the 4D path ignores
   * it, exactly like the old synchronous `regenerate()` did. */
  symmetry: SymmetryParams;
  /** True → the system is non-flat: lift through `toTransform4` and run the
   * 4D chaos game. Decided by the MAIN thread (`systemIsNonFlat(state)`) so
   * the view-flip bookkeeping there and the generation here can't disagree. */
  fourD: boolean;
  /** 3D color bake inputs (`buildColors`); unused on the 4D path, where color
   * is shader-owned or rebaked main-side per mode (see main.ts's
   * `applyFourDColor`). */
  colorMode: ColorMode;
  colorGamma: number;
  /**
   * Gradient palette for the height/radius color-mode ramps (fr-3b6),
   * resolved by the MAIN thread (`resolvePalette` — the bare `"custom"`
   * sentinel has no payload to cross the wire with; see `palette.ts`'s
   * `PaletteSpec`), exactly like the flame/voxel start commands' `palette`.
   * `"legacy"` is the built-in ramps; inert for every other `colorMode`, and
   * on the 4D path like the rest of the color-bake inputs.
   */
  rampPalette: PaletteSpec;
  /** The position mode's custom axis colors (fr-8k7) — `buildColors`'
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
}

/** The 4D result: the 4D chaos-game output as-is. No baked colors — the 4D
 * projection's color is shader-owned (w-ramp modes) or rebaked main-side per
 * mode over the cached result (see main.ts's `applyFourDColor`), exactly as
 * it was under the synchronous path. */
export interface CloudResult4D extends ChaosGame4Result {
  id: number;
  fourD: true;
}

/** Worker → main thread: the generated cloud, tagged with the request's id. */
export type CloudResult = CloudResult3D | CloudResult4D;

/**
 * XOR'd into `request.seed` to derive the iteration-local stream's own seed
 * (fr-2wfw; the golden-ratio constant, but any fixed value works —
 * `mulberry32`'s mixing decorrelates any two distinct seeds). One derivation
 * for the 3D and 4D paths, so a flat↔4D morph's alternating requests keep
 * one discipline.
 */
const ITERATION_SEED_XOR = 0x9e3779b9;

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
 * correspondence intact across ε-different samples (fr-2wfw): on one shared
 * stream, a single differing escape — or a weight-boundary pick flip landing
 * on a `julia`-carrying map in one sample only — shifted every subsequent
 * transform pick and re-rolled the entire remaining cloud; the morph
 * visibly boiled.
 */
export function generateCloud(request: CloudRequest): CloudResult {
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
      iterRng,
    );
    return { id: request.id, fourD: true, ...result };
  }
  const result = runChaosGame(
    request.transforms,
    request.numPoints,
    rng,
    request.finalTransform,
    request.symmetry,
    iterRng,
  );
  const colors = buildColors(
    result,
    request.transforms,
    request.colorMode,
    request.colorGamma,
    request.rampPalette,
    request.positionAxisColors,
  );
  return { id: request.id, fourD: false, ...result, colors };
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
  } else {
    transfers.push(result.colors.buffer as ArrayBuffer);
  }
  return transfers;
}
