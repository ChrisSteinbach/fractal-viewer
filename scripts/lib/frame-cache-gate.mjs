/**
 * THE FRAME-CACHE GATE HELPER — the one wiring layer between the browser
 * verify gates and the content-addressed frame cache
 * (scripts/lib/frame-cache.mjs). The store owns the key and the bytes; this
 * module owns the WIRING CONVENTIONS every wired gate shares, so wiring gate
 * N+1 is a lookup at its frame-capture site and a record beside it — the
 * de-preview lesson (five sheets once grew the same wrong thing in five
 * copies) applied to the cache.
 *
 * THE DEGRADATION CONTRACT, borrowed from the warm runner's: the cache is an
 * optimization, never a contract a gate must enforce with an exit code. A
 * store error (unreadable directory, misshapen caller key, disk full) sets
 * `disabled`, is noted ONCE, and every later lookup misses / record no-ops —
 * the gate then runs exactly as it did before this module existed. A gate
 * never fails BECAUSE the cache broke; it loses the speedup instead.
 *
 * THE TRUST RULE: `force` (the gates' `--force` flag) never looks up — every
 * scenario renders fully and re-records. A hit is valid exactly while the
 * key is exact; a gate whose hit path re-renders anything must treat cached
 * bytes that disagree with a fresh render of the SAME key as a MISS and
 * re-record (the store's put overwrites atomically), never trust them.
 * Whether a hit replays the recorded verdict wholesale or only feeds a
 * re-diff is the per-gate decision the store deliberately takes no side on;
 * what every wired gate shares is recorded here:
 *
 *   - entries carry FRAMES OF SETTLED, STABLE CAPTURES ONLY — a timed-out
 *     settle, an unstable double-screenshot, a mid-preview frame is never
 *     put (the gates already own the latches; the helper just says when);
 *   - a hit may stand in for a frame whose key is exact, and verdicts that
 *     COMPARE frames are recomputed from the cached bytes on replay —
 *     self-consistency claims (same key rendered twice) stay honest only in
 *     the fresh-vs-cached shape, because two cached copies of one key
 *     compared to each other would be a tautology, not a verdict;
 *   - probe-derived metadata that bytes cannot re-derive (engine routing,
 *     capture stability, ray censuses) rides the entry verdict recorded at
 *     put time and is replayed as METADATA, never re-derived.
 *
 * THE DEVICE PROBE. `device` is a key field, but the app discloses its
 * backend label only inside a settled surface session — exactly the work the
 * cache exists to skip. `readDeviceSignature` therefore asks the BROWSER
 * (not the app) on any throwaway page — the same sources the app itself
 * reads, in the same shape: WebGPU `requestAdapter({ powerPreference:
 * "high-performance" })` + `webgpuAdapterStatus`'s exact label construction
 * for compute arms, the WebGL unmasked-renderer read for webgl arms, and the
 * same software-rasterizer regex. Same browser, same sources, same strings —
 * so the key derived pre-boot is the key the settled session would derive,
 * and a mismatch is a machine change mid-run, not a divergence by design.
 */

import {
  FrameCacheCheckingError,
  defaultFrameCacheRoot,
  frameCacheLookup,
  frameCachePrune,
  frameCachePut,
  hashBundleDir,
} from "./frame-cache.mjs";

/** MIRROR of src/app/render-backend.ts's SOFTWARE_RENDERER_RE — kept
 * character-for-character, because this module classifies the same strings
 * the app's own disclosure will carry, and a drift here would key frames
 * under a device class the app would then contradict. The app side owns the
 * definition; this copy exists because scripts cannot import TS. */
const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|software|basic render/i;

function isSoftwareRendererLabel(label) {
  return typeof label === "string" && SOFTWARE_RENDERER_RE.test(label);
}

/**
 * PURE over the same inputs `webgpuAdapterStatus` (src/app/render-backend.ts)
 * reads. Reproduces its label construction exactly — `vendor architecture`
 * joined from non-empty fields, " (software)" suffixed when software, the
 * "fallback adapter" stand-in when a software adapter has nothing to show —
 * so a key's device label is the string the app would disclose.
 *
 * @param {Record<string, unknown> | null | undefined} info adapter.info
 * @param {boolean | undefined} adapterFallback adapter.isFallbackAdapter
 * @returns {{ software: boolean, label: string }}
 */
export function webgpuDeviceFromAdapterInfo(info, adapterFallback) {
  const fields =
    info && typeof info === "object"
      ? [info.vendor, info.architecture, info.device, info.description]
      : [];
  const stringTell = fields.some(
    (field) => typeof field === "string" && isSoftwareRendererLabel(field),
  );
  const software =
    (info && typeof info === "object" && info.isFallbackAdapter === true) ||
    adapterFallback === true ||
    stringTell;
  const base = [info?.vendor, info?.architecture]
    .filter((field) => typeof field === "string" && field.length > 0)
    .join(" ");
  const label = software
    ? `${base || "fallback adapter"} (software)`
    : base || "unknown adapter";
  return { software, label };
}

/**
 * Ask the browser what it renders with, from any page (an about:blank page
 * is ideal — no app boot, no settle). `engine` picks the SOURCE so the
 * device label matches what the keyed session will disclose: "compute" reads
 * the WebGPU adapter (requestAdapter with the app's own powerPreference, so
 * the two answers cannot diverge on dual-GPU machines), "webgl" reads the
 * unmasked WebGL renderer (extension first, masked RENDERER fallback — the
 * app-side read's exact discipline). Anything the wanted source cannot
 * produce is a CHECKING error — there is no honest key without it, and
 * degrading to a fabricated label would key frames under a lie.
 *
 * @param {import("playwright-core").Page} page
 * @param {"compute" | "webgl"} engine
 * @returns {Promise<{ software: boolean, label: string, source: string }>}
 */
export async function readDeviceSignature(page, engine) {
  const signature = await page.evaluate(async (wanted) => {
    if (wanted === "compute") {
      const gpu = navigator.gpu;
      if (!gpu) return { error: "navigator.gpu is absent" };
      const adapter = await gpu.requestAdapter({
        powerPreference: "high-performance",
      });
      if (!adapter) return { error: "requestAdapter() returned null" };
      const info = adapter.info ?? null;
      const fallback =
        (info && info.isFallbackAdapter === true) ||
        adapter.isFallbackAdapter === true;
      return {
        info: {
          vendor: info?.vendor ?? null,
          architecture: info?.architecture ?? null,
          device: info?.device ?? null,
          description: info?.description ?? null,
          isFallbackAdapter: info?.isFallbackAdapter === true,
        },
        fallback: fallback === true,
      };
    }
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    if (!gl) return { error: "no WebGL context" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return { renderer: typeof raw === "string" ? raw : null };
  }, engine);
  if (signature && typeof signature === "object" && "error" in signature) {
    throw new FrameCacheCheckingError(
      `device probe (${engine}) failed: ${signature.error}`,
    );
  }
  if (engine === "compute") {
    const device = webgpuDeviceFromAdapterInfo(
      signature.info,
      signature.fallback,
    );
    return { ...device, source: "webgpu" };
  }
  const renderer = signature.renderer;
  if (typeof renderer !== "string" || renderer.length === 0) {
    throw new FrameCacheCheckingError(
      "device probe (webgl) produced no renderer string",
    );
  }
  return {
    software: isSoftwareRendererLabel(renderer),
    label: renderer,
    source: "webgl",
  };
}

/**
 * The nine key fields as a gate builds them: the two OPTIONAL-shaped fields
 * get their stated-absence defaults here (`pose: null` — the document's own
 * pose or the deterministic auto-fit governs; `raster: {}` — the renderer's
 * fixed settings), everything else is required. The store validates the
 * full shape; this builder only centralizes the defaults so a wired gate's
 * call site states what it means and nothing more.
 *
 * @param {object} parts
 * @param {string} parts.bundle hashBundleDir(dist/app)'s hash
 * @param {string} parts.document the full scene document string
 * @param {string} parts.engine "compute" | "webgl" | ...
 * @param {{ width: number, height: number, scale: number }} parts.viewport
 * @param {{ software: boolean, label: string }} parts.device
 * @param {Record<string, string>} parts.env flat gate env/URL flags
 * @param {string} [parts.mode] render mode the frame was produced in
 *   (default "surface" — the wired gates' frames are all surface frames)
 * @param {Record<string, unknown> | null} [parts.pose]
 * @param {Record<string, unknown>} [parts.raster]
 */
export function gateKeyFields({
  bundle,
  document,
  engine,
  viewport,
  device,
  env,
  mode = "surface",
  pose = null,
  raster = {},
}) {
  return {
    bundle,
    document,
    pose,
    mode,
    engine,
    viewport,
    raster,
    device,
    env,
  };
}

/**
 * The per-gate cache handle. `gate` is the provenance name put into every
 * entry's metadata (the store deliberately keys entries WITHOUT it, so two
 * gates demanding the same frame share one entry); `force` is the gate's
 * `--force` flag; `log` receives one line per hit/miss/put and every
 * degradation.
 *
 * @param {object} options
 * @param {string} options.gate
 * @param {boolean} [options.force]
 * @param {string} [options.root]
 * @param {(line: string) => void} [options.log]
 */
export function createFrameCache({
  gate,
  force = false,
  root,
  log = (line) => console.error(line),
}) {
  const storeRoot = root ?? defaultFrameCacheRoot();
  let disabled = false;
  let disableNote = null;
  let bundleHashPromise = null;

  function degrade(error) {
    if (disabled) return;
    disabled = true;
    disableNote = String(error?.message ?? error);
    log(
      `[frame-cache] DISABLED for this run — ${disableNote}. ` +
        "Running uncached (the cache is an optimization, never a gate contract).",
    );
  }

  return {
    /** True once a store error degraded this run. */
    get disabled() {
      return disabled;
    },

    /** The `--force` flag: lookups never hit, renders always record. */
    get force() {
      return force;
    },

    /** The bundle hash, computed once per run and memoized. */
    async bundleHash(bundleDir) {
      if (disabled) return null;
      try {
        bundleHashPromise ??= hashBundleDir(bundleDir);
        return await bundleHashPromise;
      } catch (error) {
        bundleHashPromise = null;
        degrade(error);
        return null;
      }
    },

    /**
     * Look up one frame. Returns the store hit ({png, entry, hash, ...}) or
     * null on a miss, on `force`, or after a degradation. The caller owns
     * what a hit may stand in for (see the trust rule above).
     *
     * @param {Record<string, unknown>} fields the nine key fields
     * @param {string} scenario the scenario name for the log line
     */
    async lookup(fields, scenario) {
      if (disabled || force) return null;
      try {
        const hit = await frameCacheLookup(storeRoot, fields);
        if (hit) {
          log(
            `[frame-cache] HIT   ${gate}/${scenario} (${hit.hash.slice(0, 8)}, recorded ${new Date(hit.entry.meta.createdAtMs).toISOString()})`,
          );
        } else {
          log(`[frame-cache] MISS  ${gate}/${scenario}`);
        }
        return hit;
      } catch (error) {
        degrade(error);
        return null;
      }
    },

    /**
     * Record one frame. Call this ONLY with a settled, stable capture — a
     * timed-out settle's mid-strip frame must never become the key's frame.
     * An existing entry under the same key is overwritten atomically (a
     * fresh-vs-cached collision re-records here), and the timestamp refresh
     * keeps the entry newest for the prune. Returns whether it recorded.
     *
     * @param {Record<string, unknown>} fields the nine key fields
     * @param {object} frame
     * @param {string} frame.scenario
     * @param {Uint8Array | Buffer} frame.png
     * @param {unknown} [frame.verdict] frame-pure verdict / probe metadata
     * @param {number} [frame.wallMs]
     * @param {string} [frame.notes]
     */
    async record(fields, { scenario, png, verdict, wallMs, notes }) {
      if (disabled) return false;
      try {
        const { hash, existed } = await frameCachePut(storeRoot, {
          fields,
          png,
          verdict,
          meta: {
            gate,
            scenario,
            ...(wallMs === undefined ? {} : { wallMs }),
            ...(notes === undefined ? {} : { notes }),
          },
        });
        log(
          `[frame-cache] PUT   ${gate}/${scenario} (${hash.slice(0, 8)}${existed ? ", refreshed" : ""})`,
        );
        return true;
      } catch (error) {
        degrade(error);
        return false;
      }
    },

    /**
     * Prune the store to its bounds (45 days / 1 GiB by default). Called at
     * a gate's exit; a degradation is silent — pruning is housekeeping.
     */
    async prune() {
      if (disabled) return null;
      try {
        return await frameCachePrune(storeRoot);
      } catch {
        return null;
      }
    },
  };
}
