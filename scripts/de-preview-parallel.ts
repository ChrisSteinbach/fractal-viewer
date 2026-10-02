/**
 * Worker-scheduled rendering through `renderPreview` — NOT a ninth marcher.
 *
 * The bead's premise, audited against the serial renderer first: the march
 * already HAS the two-pass shape. Every pixel's color is computed from the
 * scene and that pixel alone — there is no per-image normalization pass
 * anywhere in `renderPreview`, so nothing needs restructuring to parallelize
 * (the "pass two normalizes over the assembled image" split the plan
 * anticipated is simply absent: color is quantized per pixel at the write).
 * What crosses a pixel boundary is exactly three things, and all three are
 * partition-safe by construction: the counters (`hits`/`evals`/`steps`/
 * `exhausted`) are integer SUMS, which are order-free; the optional
 * `status`/`hitPos`/`stepCount` arrays are per-pixel, so tiles stitch by
 * coordinates; and `ms` is a timing, not a byte. AO and the cone shadow are
 * per-pixel too, as the plan expected. The property the parallel path rides
 * is the one `de-preview.test.ts` already pins as "preserves full-image
 * rays, shading and pixel seeds across capture bands": a region render is
 * byte-identical to the same pixels of the full render, so tiles schedule
 * the IDENTICAL per-pixel arithmetic the serial call would run.
 *
 * What cannot cross `worker_threads` is code: a `PreviewScene` is full of
 * closures (`de`, `shade`, `rayLinear`, ...), and a worker cannot receive
 * one. So the parallel entry takes a FACTORY instead of a scene — a module
 * specifier plus a named export that builds the scene from data — and each
 * worker rebuilds the scene itself before rendering its tiles. Byte-identity
 * then holds BY CONSTRUCTION (same renderer, same scene data, no shared
 * mutable state), provided the factory is deterministic: no `Math.random`,
 * no clock, no import-time state that could differ between a main-thread
 * import and a worker-bundled one. That is a per-call-site obligation, and
 * the adoption tests below pin it where it is used.
 *
 * THE CONTRACT, stated once:
 *
 * - `spec.module` is a module specifier exactly as the calling sheet would
 *   import it — relative paths resolve against `scripts/` (this module's
 *   directory), absolute POSIX paths work in both the host's dynamic import
 *   and the esbuild-bundled worker.
 * - `spec.factory` names an export `(…args) => PreviewScene`; the scene must
 *   be a pure function of `spec.args` (structured-cloneable data only —
 *   functions cannot ride the message).
 * - Options: `workers` (default `availableParallelism()`), `tileSize`
 *   (default 64px — small enough that a 256px preview spreads across the
 *   pool instead of straggling), `minPixels` (below this the call renders
 *   in-thread; see `PARALLEL_MIN_PIXELS`).
 * - `DE_PREVIEW_PARALLEL=off` (or `0`/`false`/`serial`) forces the serial
 *   path everywhere — the operational fallback for environments where
 *   worker spawning is unavailable, and the serial arm of the measured A/B.
 *
 * The worker bundle is an esbuild build of a generated wrapper (factory
 * specifier inlined so the import is static) cached per process — bundle and
 * pool are reused across calls, and idle workers are unref'd so a persistent
 * pool never holds the host event loop. A fresh process re-bundles (~0.1s,
 * measured), which is what keeps the bundle honest: its transitive closure
 * is re-read every run, so an edit to the factory module, to `de-preview.ts`
 * or to `src/fractal/` can never leave a stale worker rendering old math.
 *
 * Consumers: `chain-speckle.harness.ts` (the measured A/B sheet).
 */

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { WorkerPool } from "./lib/worker-pool.mjs";
import {
  renderPreview,
  validatePreviewRegion,
  type PanelStats,
  type PreviewRegion,
  type PreviewScene,
} from "./de-preview";

/** How the caller names the scene a worker will rebuild. */
export interface SceneFactorySpec {
  /** Module specifier for the factory module — exactly what the calling
   * sheet would import (relative paths resolve against `scripts/`). */
  module: string;
  /** Named export on that module: `(…args) => PreviewScene`. */
  factory: string;
  /** Structured-cloneable arguments for the factory. Functions and other
   * non-cloneable values throw before any work is dispatched. */
  args: unknown[];
}

export interface ParallelPreviewOptions {
  /** Worker thread count. Default `availableParallelism()`. Honored when
   * the pool for this factory is created; later calls share it. */
  workers?: number;
  /** Square tile side in pixels. Default 64. */
  tileSize?: number;
  /** Render serially below this many pixels. Default
   * {@link PARALLEL_MIN_PIXELS}; `0` forces the parallel path. */
  minPixels?: number;
}

/** Below this pixel count a call renders in-thread. 256² = the point the
 * plan anchors ("a 256px preview still wins"): a serial 256px panel of the
 * escape-chain fixtures costs seconds (measured in
 * `docs/gate-velocity.md`'s parallel-de-preview section), far above the
 * one-time bundle+spawn overhead, while a smaller panel — or a cheap DE at
 * any size — has nothing to amortize it against. */
export const PARALLEL_MIN_PIXELS = 1 << 16;

const DEFAULT_TILE_SIZE = 64;
const DEFAULT_WORKERS = availableParallelism();

/** The kill switch: `off`/`false`/`0`/`serial` (case-insensitive) forces the
 * in-thread path. Anything else — including absent — plans by size. */
function parallelDisabledByEnv(): boolean {
  const value = process.env.DE_PREVIEW_PARALLEL;
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "off" ||
    normalized === "false" ||
    normalized === "0" ||
    normalized === "serial"
  );
}

/** The parallel/serial decision, pure so it is testable and so a sheet can
 * disclose which path a panel took without poking the environment itself. */
export function planParallelPreview(
  pixels: number,
  opts: ParallelPreviewOptions = {},
): "serial" | "parallel" {
  if (parallelDisabledByEnv()) return "serial";
  const min = opts.minPixels ?? PARALLEL_MIN_PIXELS;
  return pixels >= min ? "parallel" : "serial";
}

/** Tile a crop into square regions, exactly covering it (row-major, so tile
 * index order is deterministic even though assembly is order-free). */
function tileRegion(crop: PreviewRegion, tileSize: number): PreviewRegion[] {
  if (!Number.isInteger(tileSize) || tileSize < 1) {
    throw new Error("Preview tile size must be a positive integer");
  }
  const tiles: PreviewRegion[] = [];
  for (let y = 0; y < crop.height; y += tileSize) {
    for (let x = 0; x < crop.width; x += tileSize) {
      tiles.push({
        x: crop.x + x,
        y: crop.y + y,
        width: Math.min(tileSize, crop.width - x),
        height: Math.min(tileSize, crop.height - y),
      });
    }
  }
  return tiles;
}

// ------------------------------------------------------------ worker bundle

interface TileTask {
  id: number;
  sceneId: string;
  size: number;
  region: PreviewRegion;
  factoryArgs: unknown[];
}

type TileReply =
  | {
      id: number;
      ok: true;
      stats: PanelStats;
    }
  | { id: number; ok: false; error: string };

/** The worker half, generated per factory so the factory import is static
 * and esbuild-resolvable. Scenes build once per sceneId and are reused
 * across a worker's tiles; build failures are reported per task and never
 * cached. Buffers transfer rather than clone (they are freshly allocated
 * per tile and dead on this side). */
function wrapperSource(spec: SceneFactorySpec): string {
  return `
import { parentPort } from "node:worker_threads";
import { renderPreview } from "./de-preview";
import * as factoryModule from ${JSON.stringify(spec.module)};
const build = factoryModule[${JSON.stringify(spec.factory)}];
if (typeof build !== "function") {
  throw new Error(${JSON.stringify(
    `de-preview-parallel worker: module ${spec.module} has no function export named ${spec.factory}`,
  )});
}
const scenes = new Map();
function message(value) {
  return value instanceof Error ? value.message : String(value);
}
parentPort.on("message", (task) => {
  let scene;
  try {
    scene = scenes.get(task.sceneId);
    if (scene === undefined) {
      scene = build(...task.factoryArgs);
      scenes.set(task.sceneId, scene);
    }
  } catch (error) {
    parentPort.postMessage({ id: task.id, ok: false, error: message(error) });
    return;
  }
  try {
    const stats = renderPreview(scene, task.size, task.region);
    const transfer = [];
    for (const key of ["rgb", "status", "hitPos", "stepCount"]) {
      const array = stats[key];
      if (array) transfer.push(array.buffer);
    }
    parentPort.postMessage({ id: task.id, ok: true, stats }, transfer);
  } catch (error) {
    parentPort.postMessage({ id: task.id, ok: false, error: message(error) });
  }
});
`;
}

const scriptsDir = dirname(fileURLToPath(import.meta.url));

interface PoolEntry {
  pool: WorkerPool;
  file: string;
}

/** Bundle path + pool, cached per (wrapper source, worker count). The bundle
 * lives in the OS temp dir with a process-unique name, so concurrent
 * processes never share a file and nothing accumulates in the repo. */
const pools = new Map<string, Promise<PoolEntry>>();

async function ensurePool(
  spec: SceneFactorySpec,
  workers: number,
): Promise<WorkerPool> {
  const sourceHash = createHash("sha256")
    .update(wrapperSource(spec))
    .digest("hex")
    .slice(0, 16);
  const key = `${sourceHash}:${workers}`;
  const cached = pools.get(key);
  if (cached) return (await cached).pool;
  const created = (async () => {
    const dir = join(tmpdir(), "fractal-viewer-de-preview");
    const file = join(dir, `worker-${sourceHash}-${process.pid}.mjs`);
    mkdirSync(dir, { recursive: true });
    await build({
      stdin: {
        contents: wrapperSource(spec),
        resolveDir: scriptsDir,
        sourcefile: "de-preview-parallel.worker.ts",
        loader: "ts",
      },
      outfile: file,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      logLevel: "silent",
    });
    return { pool: new WorkerPool(file, workers), file };
  })();
  pools.set(key, created);
  return (await created).pool;
}

/** Terminate every cached pool (and drop its bundle reference). A sheet
 * that wants a deterministic teardown calls this at its end; a process
 * exit reclaims unref'd workers either way. */
export async function disposePreviewWorkers(): Promise<void> {
  const entries = [...pools.values()];
  pools.clear();
  await Promise.all(
    entries.map(async (entry) => {
      const { pool } = await entry;
      await pool.close();
    }),
  );
}

// ------------------------------------------------------------- serial path

/** Build the scene in-thread (the serial fallback and the kill switch's
 * path) through the same factory the workers would use. */
async function buildSceneInThread(
  spec: SceneFactorySpec,
): Promise<PreviewScene> {
  const mod = (await import(spec.module)) as Record<string, unknown>;
  const build = mod[spec.factory];
  if (typeof build !== "function") {
    throw new Error(
      `de-preview-parallel: module ${spec.module} has no function export named ${spec.factory}`,
    );
  }
  const built = (build as (...args: unknown[]) => unknown)(...spec.args);
  return built as PreviewScene;
}

// ------------------------------------------------------------- the renderer

let sceneCounter = 0;
/** Dispatch ids are POOL-GLOBAL, not per call: the pool keys its pending
 * map by `task.id`, and two concurrent calls over one pool would collide
 * at 0 and hang the first call's dispatch forever. */
let dispatchCounter = 0;

/** Render one square panel of a factory-built scene: tiles across worker
 * threads above the size threshold, in-thread below it. Byte-identical to
 * `renderPreview` of the same scene by construction — pinned per adopting
 * call site, never assumed. */
export async function renderPreviewParallel(
  spec: SceneFactorySpec,
  size: number,
  region?: PreviewRegion,
  opts: ParallelPreviewOptions = {},
): Promise<PanelStats> {
  const started = Date.now();
  if (typeof spec.module !== "string" || spec.module.length === 0) {
    throw new Error("SceneFactorySpec.module must be a non-empty specifier");
  }
  if (typeof spec.factory !== "string" || spec.factory.length === 0) {
    throw new Error("SceneFactorySpec.factory must be a non-empty export name");
  }
  // Fail fast on non-cloneable args before any worker is involved.
  structuredClone(spec.args);
  const crop = validatePreviewRegion(size, region);
  if (planParallelPreview(crop.width * crop.height, opts) === "serial") {
    const scene = await buildSceneInThread(spec);
    return renderPreview(scene, size, region);
  }

  const tileSize = opts.tileSize ?? DEFAULT_TILE_SIZE;
  const tiles = tileRegion(crop, tileSize);
  const pool = await ensurePool(spec, opts.workers ?? DEFAULT_WORKERS);
  const sceneId = `scene-${++sceneCounter}`;
  const tasks: TileTask[] = tiles.map((region) => ({
    id: ++dispatchCounter,
    sceneId,
    size,
    region,
    factoryArgs: spec.args,
  }));
  const replies = await Promise.all(
    tasks.map((task) => pool.dispatch<TileReply>(task)),
  );

  const width = crop.width;
  const height = crop.height;
  const rgb = new Uint8Array(width * height * 3);
  let status: Uint8Array | undefined;
  let hitPos: Float32Array | undefined;
  let stepCount: Uint16Array | undefined;
  let hits = 0;
  let evals = 0;
  let steps = 0;
  let exhausted = 0;
  for (let i = 0; i < replies.length; i++) {
    const reply = replies[i];
    if (!reply.ok) throw new Error(reply.error);
    const s = reply.stats;
    const tile = tasks[i].region;
    const dx = tile.x - crop.x;
    const dy = tile.y - crop.y;
    for (let row = 0; row < tile.height; row++) {
      rgb.set(
        s.rgb.subarray(row * tile.width * 3, (row + 1) * tile.width * 3),
        ((dy + row) * width + dx) * 3,
      );
    }
    if (s.status) {
      status ??= new Uint8Array(width * height);
      for (let row = 0; row < tile.height; row++) {
        status.set(
          s.status.subarray(row * tile.width, (row + 1) * tile.width),
          (dy + row) * width + dx,
        );
      }
    }
    if (s.hitPos) {
      hitPos ??= new Float32Array(width * height * 3);
      for (let row = 0; row < tile.height; row++) {
        hitPos.set(
          s.hitPos.subarray(row * tile.width * 3, (row + 1) * tile.width * 3),
          ((dy + row) * width + dx) * 3,
        );
      }
    }
    if (s.stepCount) {
      stepCount ??= new Uint16Array(width * height);
      for (let row = 0; row < tile.height; row++) {
        stepCount.set(
          s.stepCount.subarray(row * tile.width, (row + 1) * tile.width),
          (dy + row) * width + dx,
        );
      }
    }
    hits += s.hits;
    evals += s.evals;
    steps += s.steps;
    exhausted += s.exhausted;
  }
  return {
    rgb,
    width,
    height,
    hits,
    evals,
    steps,
    exhausted,
    status,
    hitPos,
    stepCount,
    ms: Date.now() - started,
  };
}
