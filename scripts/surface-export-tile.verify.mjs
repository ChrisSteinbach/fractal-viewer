#!/usr/bin/env node
/**
 * Export-tiling gate: does a TILED compute capture reproduce the
 * untiled one, pixel for pixel? The exported frame enables Surface depth of
 * field after settle, then switches to a radial live background, so the same
 * comparison proves the one full-image filter crosses tile seams.
 *
 * THE BUG THIS EXISTS TO CATCH. `SurfaceComputeRenderer` allocates eight
 * per-ray buffers for a whole frame (44 B/ray with the march-status and
 * background-layer sidecars, 36 before the background layer; the ray state
 * alone is 16 B), and a capture's rays scale with
 * exportScale SQUARED — a 4x export of a 1920x1057 pane is 32.5M rays, a
 * 520 MB ray-state buffer inside a ~1.43 GB GPU frame. Devices refuse that, and
 * WebGPU does not throw for it:
 * `createBuffer` returns an INVALID buffer plus a validation error, and
 * the first REJECTION comes from a staging `mapAsync` several awaits later
 * — which is exactly how the bug reached a user, as a failed Save-PNG and
 * a console line ("Mapping WebGPU buffer failed: Invalid buffer") naming
 * nothing that caused it. So a capture now traces full-width horizontal
 * BANDS under the device's own ceiling and assembles them.
 *
 * Why a GATE and not a one-off check: a band is not simply "the same frame,
 * cropped". Three things have to be re-derived per band, and each fails
 * silently-but-visibly if it drifts:
 *   - the RAYS (the full-image pixel, from the band's bgOffset, against
 *     the whole image's projection — get the sign of the offset wrong and
 *     the bands stack in the wrong order, or mirror);
 *   - the trace EPS (a band's pixels are the full image's pixels, so its
 *     cone footprint is the full image's, not its own raster's);
 *   - the BACKDROP STOPS (every tracer spreads its two stops over its OWN
 *     rasterHeight, so a band handed the whole image's stops repeats the
 *     whole gradient — nine bright-to-dark ramps down one export).
 * Every one of those reads as a stripe pattern in a PNG nobody looks at
 * until it is shared. Comparing against the untiled render of the same
 * pinned camera catches all three at once.
 *
 * TWO ARMS, one pinned scene (a 2-map pure-boxfold pair — compute-shaped,
 * so the session runs the WebGPU tracer, and cheap enough to settle under
 * SwiftShader; the hash carries an explicit `camera`, which is what makes
 * the render reproducible run to run):
 *   A. no flag           -> the export fits one frame: ONE tile.
 *   B. ?surfacemaxrays=N -> the same export under a pretended device
 *                           ceiling: MANY tiles, same pixels.
 * The flag stands in for a device limit precisely so this gate can run on
 * a cheap 1x export; on a real device the banding only starts at 2-4x,
 * which is minutes of tracing per arm.
 *
 * Also asserted, because a green diff would otherwise be vacuous: both
 * arms really ran the WebGPU compute tracer (a box without an adapter
 * would compare two WebGL exports and prove nothing), arm A really used
 * one tile, arm B really used several, and only arm B's live pane fitted
 * itself under the ceiling (`fitSurfaceComputeRaster`, the other half of
 * what the ceiling drives).
 *
 * MEASURED (headless SwiftShader, 900x560, 9 bands), shipped code against
 * two deliberate mutations of the band derivation:
 *   shipped                        mean 0.0020/255, 0.006% of px off >8
 *   whole-image stops per band     mean 7.3220/255, 53.0% — nine ramps
 *   flipped setViewOffset y        mean 68.3603/255, 89.1% — mirrored
 * i.e. the gate separated correct from broken by 3600x and 34000x on the
 * mean. (Both mutations predate the bit-exact change below and are quoted
 * as measured; the second one no longer has a `setViewOffset` to flip —
 * its equivalent today is a wrong sign on the band's `bgOffset`.) A run
 * costs ~6 minutes on that box (two settles, two exports).
 *
 * THE BAR IS NOW BIT-EXACT, and the 0.0020 residual above is gone with
 * it. It was the march-start dither's per-raster hash phase along
 * silhouettes — the band-local pixel row fed to a hash — and the same
 * flaw cost the LIT export far more, when a participating medium still
 * integrated along the whole terminal distance a dithered march start
 * moves: 0.408/255 mean and 5.9% of channels across an authored
 * 8-sample cathedral capture. Fixing it took the ray's NDC with it: a
 * band is now a row range of the WHOLE image's projection, and the
 * full-image pixel — from bgOffset/bgExtent — is what derives the NDC,
 * the dither and the transport's per-pixel seed alike, so the band's own
 * raster height reaches no per-pixel arithmetic at all. MEASURED after
 * the fix, real AMD RX 7900 XTX (radeonsi) at 900x560 in 9 bands:
 * mean 0.0000/255, max 0, 0.000% off by >8 — byte for byte. Any drift is
 * now a band-derived difference to explain, never a tolerance to widen.
 *
 * THE TRANSMISSION LEG (--scene=transmission|all, default boxfold): the
 * app-level export path with the optical transport's distorted rays
 * actually rendered — the criterion the distortion child's closure deferred
 * to this task's routing. Band independence is CONSTRUCTIONAL (the
 * transport carries no screen-space state; the displaced rear seam reads
 * the same full-image pixel a band's ray derivation already reproduces,
 * and the renderer-level repeat was byte-identical with the slab live),
 * so what this leg adds is the proof at the export seam: the closed-solid
 * backend SELECTED (the routing's own answer — the scene is the emitter-
 * only union shape it admits), the distortion AUTHORED (0.08, the study's
 * working value), and bright high-contrast rear structure crossing band
 * boundaries — a checker floor and members of several sizes, in 3D and in
 * native posed 4D. Both scenes are the shipped Glass transmission
 * starters' own documents (persist.ts's encoder output, minted from
 * surface-transmission-starters.ts), so the leg cannot drift from what a
 * user actually loads. Each scene boots untiled and under the pretended
 * ceiling, settles, and saves; the pair must be byte-identical, and the
 * run asserts the premises that make the comparison worth reading:
 * compute tracer active, the ?surfacetrace ring carrying
 * `transport pass=` lines (the lane live), and the tile counts.
 *
 * THE FINITE FRACTAL LEG (--scene=finite|all) authors glassMenger and
 * glassMenger4 through the app's preset menu, freezes each resulting hash,
 * and saves that same document with and without the device ceiling. Its
 * canonical camera, native 4D pose, studio background and Glass optics are
 * the preset's own; unlike the older filter legs, this leg does not edit
 * DoF or replace its backdrop. Every sample in every saved band must finish
 * with zero unresolved/invalid optical paths and no exhausted march work.
 * Both PNGs, source documents and complete export traces are retained under
 * --out (default scripts/out/finite-glass-export for this leg).
 * --viewport and --samples override only this finite leg. The sample override
 * is authored through the real numeric control and saved in the document;
 * its original preset hash and sample count remain in the report. Explicit
 * --viewport=1920x1080 --samples=4 additionally requires each preset's default
 * complete 1x download within 120s on a named adapter and certified quiet run.
 * The forced --maxrays arm is artificial-band stress: its measured delivery
 * time is reported, while complete rendering and exact pixel identity remain
 * required. docs/surface-dielectric-study.md's "Decided feasibility envelope"
 * qualifies canonical export time separately from "Exact tile and window
 * invariants". The study launcher's --tileCheck predicate likewise requires
 * completion/identity without a timing limit; it does not impose 120s on
 * arbitrary forced decompositions. Both arms keep the 300s failure watchdog.
 * The saved raster is the full canvas with centered capture projection,
 * independent of the live panel inset. This qualifies export wall time,
 * dimensions, completion, observed submission checkpoints and pixel identity.
 * Default full-HD transport submissions must also stay within the selected
 * 600ms checkpoint line; a quick cancellation probe alone cannot reveal a
 * later dense pixel's slow submission. Cancellation acknowledgement and
 * retained memory still have their separate instruments below.
 * --cancel-only runs a separate finite cancellation qualification in both
 * dimensions and both tiling arms: cancel during an identified export's
 * optical work, trusted click to acknowledgement <=600ms, no download,
 * then a new camera frame after a real drag. It does not save the identity
 * pair or certify export throughput/memory. Its report and traces are separate.
 * --memory-only requires explicit --viewport=1920x1080 --samples=4. Fresh
 * browser processes compare identical opaque/glass geometry in each dimension.
 * Pipelines warm at 256x144, their buffers release, and one recorded CDP GC
 * precedes the full-HD controls plateau. Live render and two repeated saves
 * then measure retained host RSS without GC; presentation/encoding is separate.
 * GPU buffer create/destroy census independently pins 40*C+32*slots plus
 * 16+2736*min(C,4096)+4 bytes of finite continuation scratch, where C is
 * actual retained capacity. Each observable is checked against128MiB; they
 * are never added. Driver-private memory/VRAM and prior larger-raster capacity
 * histories remain outside this specifically scoped qualification.
 *
 * Usage: node scripts/surface-export-tile.verify.mjs [--url=...]
 *          [--display=:0] [--maxrays=60000] [--out=/tmp]
 *          [--scene=boxfold|transmission|finite|all]
 *          [--viewport=1920x1080] [--samples=4] (finite leg only)
 *          [--cancel-only] (finite cancellation only; --scene defaults finite)
 *          [--memory-only] (finite memory only; explicit Full HD4AA required)
 * (url defaults to https://localhost:4173 — `npm run build && npm run
 * preview` first. --display runs headed against a real X display / real
 * driver instead of headless SwiftShader; --out keeps both exports as
 * PNGs to eyeball, which is how a failing diff gets read.)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { createHash } from "node:crypto";
import process from "node:process";
import { chromium } from "playwright-core";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { completionFailures, traceFrames } from "./lib/finite-glass-trace.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
import { sampleProcessTreeRss } from "./lib/process-tree-memory.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const BASE = (args.url ?? "https://localhost:4173").replace(/\/+$/, "");
const DISPLAY = args.display;
/** Pretended per-frame ray ceiling for arm B. 60k rays over a 900px-wide
 * export is a 66-row band, so the 560-row export tiles into 9. */
const MAX_RAYS = Number(args.maxrays ?? 60_000);
const CANCEL_ONLY = args["cancel-only"] !== undefined;
const MEMORY_ONLY = args["memory-only"] !== undefined;
if (CANCEL_ONLY && MEMORY_ONLY)
  throw new Error(
    "--cancel-only and --memory-only are separate qualifications",
  );
const FINITE_OUT =
  args.out ??
  (MEMORY_ONLY
    ? "scripts/out/finite-glass-memory"
    : CANCEL_ONLY
      ? "scripts/out/finite-glass-export-cancel"
      : "scripts/out/finite-glass-export");
const FINITE_REPORT_FILE = MEMORY_ONLY
  ? "finite-glass-memory-report.json"
  : CANCEL_ONLY
    ? "finite-glass-export-cancel-report.json"
    : "finite-glass-export-report.json";
const DEFAULT_VIEWPORT = { width: 900, height: 560 };
const viewportMatch = /^(\d+)x(\d+)$/.exec(args.viewport ?? "900x560");
if (!viewportMatch || viewportMatch.slice(1).some((value) => Number(value) < 1))
  throw new Error("--viewport must be positive WIDTHxHEIGHT, e.g. 1920x1080");
const FINITE_VIEWPORT = {
  width: Number(viewportMatch[1]),
  height: Number(viewportMatch[2]),
};
const FINITE_SAMPLES = args.samples === undefined ? null : Number(args.samples);
if (FINITE_SAMPLES !== null && ![1, 2, 4, 8, 16].includes(FINITE_SAMPLES))
  throw new Error("--samples must be one of 1, 2, 4, 8, 16");
const QUALIFY_FULL_HD =
  args.viewport !== undefined &&
  FINITE_VIEWPORT.width === 1920 &&
  FINITE_VIEWPORT.height === 1080 &&
  FINITE_SAMPLES === 4;
const FULL_HD_EXPORT_LIMIT_MS = 120_000;
const EXPORT_CANCEL_LIMIT_MS = 600;
const RETAINED_RENDER_LIMIT_BYTES = 128 * 1024 * 1024;
if (MEMORY_ONLY && !QUALIFY_FULL_HD)
  throw new Error(
    "--memory-only requires explicit --viewport=1920x1080 --samples=4",
  );
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function pngDimensions(bytes) {
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  )
    return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const namedHardware = (backend) =>
  Boolean(
    backend?.label &&
    !backend.software &&
    !/swiftshader|llvmpipe|software/i.test(backend.label),
  );

/** The boxfold PAIR (surface-fold.verify.mjs's BOXFOLD_HASH: two
 * single-variation boxfold maps, `deHasFolds` true, eligibility
 * "eligible") with three things pinned on top:
 *   - an explicit CAMERA, freezing the exact gate viewpoint independently
 *     of future fit changes. Before main.ts introduced deterministic
 *     `BOOT_SEED`, pose-less auto-framing drifted ~0.3% per load and would
 *     have swamped the diff this gate exists to read; current direct boots
 *     no longer have that randomness;
 *   - the RINGS color source, so the comparison covers a LUT-sampled
 *     palette rather than flat per-slot colors;
 *   - the GROUND PLANE, which is what makes the frame worth
 *     comparing at all. This attractor is a sparse dust — ~1500 of
 *     504k pixels hit it — and a diff over a frame that is 99.7%
 *     backdrop barely moves when the geometry does: the flipped-band
 *     mutation below measured 0.79% of pixels off without the floor,
 *     against a 0.5% bound. The floor fills the lower frame with
 *     analytically-shaded, view-dependent pixels for almost no trace
 *     cost, and any band-projection error slides its horizon.
 */
const SCENE =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjEsMF0sInJvdGF0aW9uIjpbMC4zLDAuMiwwXSwic2NhbGUiOlswLjQ1LDAuNDUsMC40NV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxfV19LHsicG9zaXRpb24iOlstMC4zNSwtMC4yLDAuM10sInJvdGF0aW9uIjpbMCwwLjUsMC4xXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjowLjl9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoicmluZ3MiLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJheGlzIjoieSJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMTcyNiwtMC4wNjU1LDAuMjQ1XSwicmFkaXVzIjowLjYyLCJ0aGV0YSI6MC43ODU0LCJwaGkiOjEuMDU2fSwiZ3JvdW5kUGxhbmUiOnRydWV9";

/** The Glass transmission starters' own documents — persist.ts's encoder
 * output, minted from surface-transmission-starters.ts (the optics
 * fixtures' precedent: hand-built JSON fails the strict decoder, so the
 * scenes are the encoder's). The leg boots these exact documents, so the
 * gate cannot drift from what a user loads. */
const TRANSMISSION_SCENES = [
  {
    name: "glassGarden3",
    what: "the 3D Glass garden starter - closed-solid backend, distortion 0.08, checker floor",
    hash: "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsLTAuMSwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC42MiwwLjYyLDAuNjJdLCJjb2xvckluZGV4IjowLjU1LCJvcHRpY3MiOnsibW9kZWwiOiJkaWVsZWN0cmljIiwiZGlzdG9ydGlvbiI6MC4wOH0sImVtaXR0ZXIiOlsicyIsMV19LHsicG9zaXRpb24iOlswLC0wLjg1LC0wLjc1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJjb2xvckluZGV4IjowLjcyLCJvcHRpY3MiOnsibW9kZWwiOiJkaWVsZWN0cmljIiwiZGlzdG9ydGlvbiI6MC4wOH0sImVtaXR0ZXIiOlsicyIsMV19LHsicG9zaXRpb24iOlstMC44NSwtMC4zNSwwLjQ1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC4zLDAuMywwLjNdLCJjb2xvckluZGV4IjowLjQyLCJvcHRpY3MiOnsibW9kZWwiOiJkaWVsZWN0cmljIiwiZGlzdG9ydGlvbiI6MC4wOH0sImVtaXR0ZXIiOlsicyIsMV19LHsicG9zaXRpb24iOlswLjksLTAuNDUsMC4zXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC4yNiwwLjI2LDAuMjZdLCJjb2xvckluZGV4IjowLjEyLCJvcHRpY3MiOnsibW9kZWwiOiJkaWVsZWN0cmljIiwiZGlzdG9ydGlvbiI6MC4wOH0sImVtaXR0ZXIiOlsicyIsMV19LHsicG9zaXRpb24iOlswLjU1LC0wLjYyLC0wLjVdLCJyb3RhdGlvbiI6WzAuMSwwLjQ1LDAuMDVdLCJzY2FsZSI6WzAuMzQsMC43MiwwLjM0XSwiY29sb3JJbmRleCI6MC4zLCJvcHRpY3MiOnsibW9kZWwiOiJkaWVsZWN0cmljIiwiZGlzdG9ydGlvbiI6MC4wOH0sImVtaXR0ZXIiOlsiYiIsMC43LDEsMC43XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOmZhbHNlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiZW52TGlnaHQiOjAsImZsb29yRW5hYmxlZCI6ZmFsc2UsImZsb29yUGF0dGVybiI6InNvbGlkIiwiZmxvb3JUaWxlU2NhbGUiOjAuNjQsImZsb29yRW1pc3Npb24iOjAsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNSwiZW52TGlnaHQiOjAuMzUsImZsb29yUGF0dGVybiI6ImNoZWNrZXIiLCJmbG9vclRpbGVTY2FsZSI6MC42NCwiZmxvb3JFbWlzc2lvbiI6MH0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJiYWxsb29uRWNobyI6ZmFsc2UsImJhbGxvb25SYWRpdXMiOjEuNiwiYmFsbG9vblRpbnQiOiIjMDAwMDAwIiwiYmFsbG9vblRpbnRTdHJlbmd0aCI6MCwiZm9nRGVuc2l0eSI6MCwiZm9nVGludCI6IiNmZmZmZmYiLCJmb2dUaW50U3RyZW5ndGgiOjAsImdyb3VuZFBsYW5lIjp0cnVlLCJiYWNrZ3JvdW5kIjp7Im1vZGUiOiJjdXN0b20iLCJ0b3AiOiIjY2RkNmUxIiwiYm90dG9tIjoiIzk0OWFhOCJ9LCJjYW1lcmEiOnsidGFyZ2V0IjpbMCwtMC4yNSwwXSwicmFkaXVzIjoyLjY4NDIxMzEwNjI5MzkxLCJ0aGV0YSI6MC40NTUxMDA4MDg1NjgxOTQ1NywicGhpIjoxLjM0NTM2MjUzNjk0NjAwNDMsImZvdiI6NjMuNTk3ODI1NjQ4NTg4ODQ1fX0",
  },
  {
    name: "glassCells4",
    what: "the 4D Glass cells starter - the same material at the canonical posed slice",
    hash: "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNSwtMC4xNSwwLjQ1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC42MiwwLjYyLDAuNjJdLCJjb2xvckluZGV4IjowLjEyLCJ3Ijp7InNjYWxlIjowLjV9LCJvcHRpY3MiOnsibW9kZWwiOiJkaWVsZWN0cmljIiwiZGlzdG9ydGlvbiI6MC4wOH0sImVtaXR0ZXIiOlsicyIsMV19LHsicG9zaXRpb24iOlstMC41LC0wLjE1LDAuNDVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjYyLDAuNjIsMC42Ml0sImNvbG9ySW5kZXgiOjAuNTUsInciOnsic2NhbGUiOjAuNX0sIm9wdGljcyI6eyJtb2RlbCI6ImRpZWxlY3RyaWMiLCJkaXN0b3J0aW9uIjowLjA4fSwiZW1pdHRlciI6WyJzIiwxXX0seyJwb3NpdGlvbiI6WzAsLTAuMTUsLTAuNl0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNjIsMC42MiwwLjYyXSwiY29sb3JJbmRleCI6MC43MiwidyI6eyJzY2FsZSI6MC41fSwib3B0aWNzIjp7Im1vZGVsIjoiZGllbGVjdHJpYyIsImRpc3RvcnRpb24iOjAuMDh9LCJlbWl0dGVyIjpbInMiLDFdfSx7InBvc2l0aW9uIjpbMCwwLjcyLDAuMV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNjIsMC42MiwwLjYyXSwiY29sb3JJbmRleCI6MC4zNSwidyI6eyJzY2FsZSI6MC41fSwib3B0aWNzIjp7Im1vZGVsIjoiZGllbGVjdHJpYyIsImRpc3RvcnRpb24iOjAuMDh9LCJlbWl0dGVyIjpbInMiLDFdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6ZmFsc2UsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJlbnZMaWdodCI6MCwiZmxvb3JFbmFibGVkIjpmYWxzZSwiZmxvb3JQYXR0ZXJuIjoic29saWQiLCJmbG9vclRpbGVTY2FsZSI6MC42NCwiZmxvb3JFbWlzc2lvbiI6MCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41LCJlbnZMaWdodCI6MC4zNSwiZmxvb3JQYXR0ZXJuIjoiY2hlY2tlciIsImZsb29yVGlsZVNjYWxlIjowLjY0LCJmbG9vckVtaXNzaW9uIjowfSwic3ltbWV0cnkiOnsib3JkZXIiOjEsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjpmYWxzZSwiYmFsbG9vblJhZGl1cyI6MS42LCJiYWxsb29uVGludCI6IiMwMDAwMDAiLCJiYWxsb29uVGludFN0cmVuZ3RoIjowLCJmb2dEZW5zaXR5IjowLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOnRydWUsImJhY2tncm91bmQiOnsibW9kZSI6ImN1c3RvbSIsInRvcCI6IiNjZGQ2ZTEiLCJib3R0b20iOiIjOTQ5YWE4In0sImNhbWVyYSI6eyJ0YXJnZXQiOlswLDAuMDUsMF0sInJhZGl1cyI6My41NTgwODkzNzQ5MzE0MzksInRoZXRhIjowLjU4MDAwMjc3NDIwNzY4MDksInBoaSI6MS4zNDQwMTc3MzMxNTcyOTMxLCJmb3YiOjYxLjkyNzUxMzA2NDE0NzA0fSwiZm91ckQiOnsicCI6WzAuOTc4MDMwOTE0NzI0MTQ4MywwLjIwODQ1OTg5OTg0NjA5OTU2LDAsMF0sInEiOlswLjk3ODAzMDkxNDcyNDE0ODMsMC4yMDg0NTk4OTk4NDYwOTk1NiwwLDBdLCJzbGljZU9uIjp0cnVlLCJzbGljZUNlbnRlciI6MCwic2xpY2VXIjowLCJzbGljZVRoaWNrbmVzcyI6MCwic2xpY2VSZWxDb2xvciI6ZmFsc2V9fQ",
  },
];

/** Bounds on the two slow waits. Generous against what this pose measures
 * under SwiftShader (settle 111s untiled / 18s under the pretended
 * ceiling, export ~100s an arm): a real timeout means the box is unusually
 * slow, not that the gate needs a longer bound. */
const SETTLE_TIMEOUT_MS = 300_000;
const SETTLE_POLL_MS = 2_000;
const EXPORT_TIMEOUT_MS = 300_000;

/** Tiling is a pixel-exact operation, full stop — see THE BAR IS NOW
 * BIT-EXACT above. Both bounds are zero on purpose: the band derivation
 * has no remaining source of drift, so there is no scatter to admit, and
 * the structural failures this gate exists for (a wrong band offset sign,
 * a band-height eps, a repeated gradient) move a large FRACTION of the
 * frame anyway. */
const MEAN_DIFF_MAX = 0;
const OVER8_FRACTION_MAX = 0;

const failures = [];
function check(ok, label) {
  console.error(`[export-tile] ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
}

/** Open a <details class="panel-section"> if it is closed — savePngBtn is
 * unclickable inside a collapsed one, and re-clicking an open summary
 * would toggle it shut (capture-export.verify.mjs's openPanelSection). */
async function openPanelSection(page, sectionId) {
  const isOpen = await page.$eval(`#${sectionId}`, (el) => el.open);
  if (!isOpen) {
    await page.click(`#${sectionId} summary`);
    await page.waitForTimeout(150);
  }
}

/** Freeze a real menu load, rather than maintaining another encoded preset
 * copy. Reduced motion parks the view while its cloud and saved pose land. */
async function authorFiniteDocument(ctx, preset, dimension) {
  const page = await ctx.newPage();
  try {
    await page.setViewportSize(
      MEMORY_ONLY ? { width: 256, height: 144 } : FINITE_VIEWPORT,
    );
    await page.goto(`${BASE}/?surfacestate`, { waitUntil: "load" });
    await page.waitForFunction(
      () => typeof window.__surfaceState === "function",
      undefined,
      { timeout: 60_000 },
    );
    if (
      MEMORY_ONLY &&
      !(await page.$eval("#panel", (panel) => panel.classList.contains("open")))
    )
      await page.click("#menuToggle");
    await page.selectOption("#presetSelect", preset);
    await page.waitForFunction(
      (wantDimension) => {
        if (!location.hash.startsWith("#v1=")) return false;
        const encoded = location.hash.slice(4);
        const document = JSON.parse(
          atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
        );
        return (
          window.__surfaceState?.().mode === "surface" &&
          document.finiteSolid?.shape ===
            (wantDimension === 4 ? "hyperMenger" : "menger") &&
          Number.isFinite(document.camera?.fov) &&
          (wantDimension === 3 || document.fourD?.sliceW !== undefined)
        );
      },
      dimension,
      { timeout: 60_000 },
    );
    const presetHash = await page.evaluate(() => location.hash);
    const presetSamples = Number(
      /^(\d+) samples\/pixel$/.exec(
        (await page.locator("#surfaceAntialiasLabel").textContent()) ?? "",
      )?.[1],
    );
    if (FINITE_SAMPLES !== null) {
      await openPanelSection(page, "rendererQualitySection");
      const samplesInput = page.locator("#surfaceAntialiasSliderNumber");
      await samplesInput.fill(String(FINITE_SAMPLES));
      await samplesInput.press("Tab");
      await page.waitForFunction(
        ({ requested, original }) => {
          const encoded = location.hash.slice(4);
          const document = JSON.parse(
            atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
          );
          return (
            (document.surface?.antialiasSamples ?? original) === requested &&
            window.document.getElementById("surfaceAntialiasLabel")
              ?.textContent === `${requested} samples/pixel`
          );
        },
        { requested: FINITE_SAMPLES, original: presetSamples },
        { timeout: 10_000 },
      );
    }
    // The render hint may already have entered Surface. Leave it before
    // booting the independent export arms, which must own their own work.
    await page.click("#modePointsBtn");
    const authored = await page.evaluate(() => {
      const hash = location.hash;
      const encoded = hash.slice(4);
      const document = JSON.parse(
        atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
      );
      const samples = Number(
        /^(\d+) samples\/pixel$/.exec(
          window.document.getElementById("surfaceAntialiasLabel")
            ?.textContent ?? "",
        )?.[1],
      );
      return { hash, document, samples };
    });
    const doc = authored.document;
    const wantShape = dimension === 4 ? "hyperMenger" : "menger";
    const wantMaps = dimension === 4 ? 48 : 20;
    if (
      doc.finiteSolid?.shape !== wantShape ||
      doc.finiteSolid.level !== 2 ||
      doc.transforms?.length !== wantMaps ||
      !doc.transforms.every(
        (transform) => transform.optics?.model === "dielectric",
      )
    ) {
      throw new Error(
        `${preset}: menu did not author the finite Glass construction`,
      );
    }
    if (
      !doc.camera ||
      !Number.isFinite(doc.camera.fov) ||
      doc.background?.mode !== "custom" ||
      !doc.background.top ||
      !doc.background.bottom ||
      !doc.groundPlane ||
      doc.surface?.floorPattern !== "checker"
    ) {
      throw new Error(
        `${preset}: menu did not carry its camera and studio scene`,
      );
    }
    if (dimension === 4) {
      const pose = doc.fourD;
      const same = Math.hypot(
        ...pose.p.map((value, axis) => value - pose.q[axis]),
      );
      const opposite = Math.hypot(
        ...pose.p.map((value, axis) => value + pose.q[axis]),
      );
      if (
        !pose.sliceOn ||
        pose.sliceW === 0 ||
        Math.min(same, opposite) <= 1e-6
      ) {
        throw new Error(`${preset}: menu did not carry the native posed slice`);
      }
    }
    if (
      !Number.isInteger(authored.samples) ||
      authored.samples < 1 ||
      (doc.surface.antialiasSamples !== undefined &&
        doc.surface.antialiasSamples !== authored.samples)
    ) {
      throw new Error(`${preset}: antialias count missing or inconsistent`);
    }
    return {
      preset,
      dimension,
      ...authored,
      presetHash,
      presetSamples,
      overrides:
        FINITE_SAMPLES === null
          ? {}
          : {
              antialiasSamples: {
                requested: FINITE_SAMPLES,
                original: presetSamples,
                effective: authored.samples,
                control: "#surfaceAntialiasSliderNumber",
              },
            },
    };
  } finally {
    await page.close();
  }
}

/** Each tile's completion line closes its own full antialias job. Keeping
 * those boundaries prevents borrowing a good sample from another tile. */
function finiteExportBands(lines, samples, label) {
  const bands = [];
  let pending = [];
  for (const line of lines) {
    const tile = /Surface compute export tile (\d+)\/(\d+) (\d+)x(\d+):/.exec(
      line,
    );
    if (!tile) {
      pending.push(line);
      continue;
    }
    const band = {
      index: Number(tile[1]),
      count: Number(tile[2]),
      width: Number(tile[3]),
      height: Number(tile[4]),
      frames: traceFrames(pending),
    };
    pending = [];
    bands.push(band);
    const prefix = `${label} band ${band.index}`;
    check(band.index === bands.length, `${prefix}: contiguous band order`);
    check(
      band.frames.length === samples,
      `${prefix}: all ${samples} antialias samples`,
    );
    const token = band.frames[0]?.token;
    check(Number.isInteger(token), `${prefix}: identified frame token`);
    for (const [index, frame] of band.frames.entries()) {
      const sample = `${prefix} sample ${index}`;
      check(
        frame.sample === index &&
          frame.samples === samples &&
          frame.token === token,
        `${sample}: belongs to this band's antialias job`,
      );
      check(
        frame.completed &&
          !frame.truncated &&
          frame.active === 0 &&
          frame.exhausted === 0,
        `${sample}: complete march with no exhausted work`,
      );
      check(
        frame.rays === band.width * band.height &&
          frame.hit +
            frame.miss +
            frame.plane +
            frame.exhausted +
            frame.active ===
            frame.rays,
        `${sample}: accounts for every exported pixel`,
      );
      const tally = frame.tallies[0];
      check(
        frame.tallies.length === 1 &&
          tally?.unresolved === 0 &&
          tally?.invalid === 0 &&
          tally.resolved === frame.hit &&
          (frame.hit === 0 || tally.passes > 0),
        `${sample}: complete optical accounting (resolved=${tally?.resolved ?? "missing"}, unresolved=${tally?.unresolved ?? "missing"}, invalid=${tally?.invalid ?? "missing"})`,
      );
    }
  }
  check(
    bands.length > 0 && bands.every((band) => band.count === bands.length),
    `${label}: every declared export band completed`,
  );
  check(
    new Set(bands.map((band) => band.frames[0]?.token)).size === bands.length,
    `${label}: distinct export job for each band`,
  );
  check(
    bands.some((band) =>
      band.frames.some((frame) => frame.tallies[0]?.resolved > 0),
    ),
    `${label}: the saved image contains resolved finite glass`,
  );
  return bands;
}

/** Cancellation-only init hook: track actual transport command submissions
 * through the native queue fence, independently of post-fence trace logging. */
function installOpticalSubmissionProbe() {
  if (
    !globalThis.GPUDevice ||
    !globalThis.GPUQueue ||
    !globalThis.GPUComputePassEncoder
  )
    return;
  const pipelines = new WeakSet();
  const passEncoders = new WeakMap();
  const passOptical = new WeakMap();
  const opticalEncoders = new WeakSet();
  const opticalCommands = new WeakSet();
  const outstanding = new Map();
  const failures = [];
  let serial = 0;
  let frame = null;
  // Keep only the current frame's identity/final records. A long frame can
  // evict its own start from the app's 6000-line diagnostic ring.
  const nativeDebug = console.debug;
  console.debug = function (...args) {
    for (const argument of args) {
      if (
        typeof argument !== "string" ||
        !argument.startsWith("[surfacetrace] ")
      )
        continue;
      const line = argument.slice("[surfacetrace] ".length);
      if (line.includes("frame start "))
        frame = {
          token: Number(/ token=(\d+)/.exec(line)?.[1]),
          sample: Number(/ sample=(\d+)/.exec(line)?.[1]),
          lines: [line],
        };
      else if (
        frame &&
        (line.includes("transport done final ") || line.includes("frame done "))
      )
        frame.lines.push(line);
    }
    return nativeDebug.apply(this, args);
  };
  const tag = (pipeline, descriptor) => {
    if (descriptor.compute?.entryPoint === "transportRays")
      pipelines.add(pipeline);
    return pipeline;
  };
  const createPipeline = GPUDevice.prototype.createComputePipeline;
  GPUDevice.prototype.createComputePipeline = function (descriptor) {
    return tag(createPipeline.call(this, descriptor), descriptor);
  };
  const createPipelineAsync = GPUDevice.prototype.createComputePipelineAsync;
  GPUDevice.prototype.createComputePipelineAsync = async function (descriptor) {
    return tag(await createPipelineAsync.call(this, descriptor), descriptor);
  };
  const beginPass = GPUCommandEncoder.prototype.beginComputePass;
  GPUCommandEncoder.prototype.beginComputePass = function (...args) {
    const pass = beginPass.apply(this, args);
    passEncoders.set(pass, this);
    return pass;
  };
  const setPipeline = GPUComputePassEncoder.prototype.setPipeline;
  GPUComputePassEncoder.prototype.setPipeline = function (pipeline) {
    const result = setPipeline.call(this, pipeline);
    passOptical.set(this, pipelines.has(pipeline));
    return result;
  };
  for (const method of ["dispatchWorkgroups", "dispatchWorkgroupsIndirect"]) {
    const dispatch = GPUComputePassEncoder.prototype[method];
    GPUComputePassEncoder.prototype[method] = function (...args) {
      const result = dispatch.apply(this, args);
      if (passOptical.get(this)) opticalEncoders.add(passEncoders.get(this));
      return result;
    };
  }
  const finish = GPUCommandEncoder.prototype.finish;
  GPUCommandEncoder.prototype.finish = function (...args) {
    const command = finish.apply(this, args);
    if (opticalEncoders.has(this)) opticalCommands.add(command);
    return command;
  };
  const nativeSubmit = GPUQueue.prototype.submit;
  const nativeFence = GPUQueue.prototype.onSubmittedWorkDone;
  GPUQueue.prototype.submit = function (commands) {
    const batch = Array.from(commands);
    const result = nativeSubmit.call(this, batch);
    if (batch.some((command) => opticalCommands.has(command))) {
      const id = ++serial;
      outstanding.set(id, {
        id,
        submittedAtMs: performance.now(),
        token: frame?.token,
        sample: frame?.sample,
      });
      nativeFence.call(this).then(
        () => outstanding.delete(id),
        (error) => {
          outstanding.delete(id);
          if (failures.length < 10) failures.push(String(error));
        },
      );
    }
    return result;
  };
  window.__finiteOpticalSubmissions = {
    snapshot: () => ({
      serial,
      outstanding: [...outstanding.values()],
      failures: [...failures],
      frame: frame ? { ...frame, lines: [...frame.lines] } : null,
    }),
  };
}

async function copiedLiveDocument(page) {
  const result = await page.evaluate(async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    let copiedLink = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            copiedLink = text;
          },
        },
      });
      const button = document.getElementById("copyLinkBtn");
      if (!(button instanceof HTMLButtonElement) || button.disabled)
        throw new Error("Copy Link is unavailable");
      button.click();
      const deadline = performance.now() + 2000;
      while (copiedLink === null && performance.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (copiedLink === null)
        throw new Error("Copy Link produced no live document");
      return { copiedLink, locationHash: location.hash };
    } finally {
      if (previous) Object.defineProperty(navigator, "clipboard", previous);
      else delete navigator.clipboard;
    }
  });
  const hash = new URL(result.copiedLink).hash;
  if (!hash.startsWith("#v1="))
    throw new Error("Copy Link returned an unsupported document");
  return {
    ...result,
    document: JSON.parse(Buffer.from(hash.slice(4), "base64url").toString()),
  };
}

function completedOpticalFrame(frame) {
  const tally = frame.tallies[0];
  return (
    frame.completed &&
    !frame.truncated &&
    frame.active === 0 &&
    frame.exhausted === 0 &&
    frame.hit > 0 &&
    frame.hit + frame.miss + frame.plane === frame.rays &&
    frame.tallies.length === 1 &&
    tally.resolved === frame.hit &&
    tally.resolved > 0 &&
    tally.passes > 0 &&
    tally.unresolved === 0 &&
    tally.invalid === 0
  );
}

/** Observe the real UI acknowledgement in the browser clock, not a polling
 * interval. The click-time submission snapshot proves an optical fence is
 * outstanding in THIS export, rather than the prior settle or a finished band. */
async function cancelFiniteExport(page, label, finite, maxRays, priorToken) {
  const evidence = {
    complete: false,
    limitMs: EXPORT_CANCEL_LIMIT_MS,
    trace: [],
    interactionTrace: [],
    downloads: [],
    requestedRaster: { ...FINITE_VIEWPORT, samples: finite.samples },
    maxRays,
  };
  finite.evidence.cancellation = evidence;
  let phase = "export";
  const onConsole = (message) => {
    const line = message.text();
    if (
      !line.startsWith("[surfacetrace] ") &&
      !line.startsWith("Surface compute export tile ")
    )
      return;
    (phase === "export" ? evidence.trace : evidence.interactionTrace).push(
      line.replace(/^\[surfacetrace\] /, ""),
    );
  };
  const onDownload = (download) => {
    evidence.downloads.push({
      filename: download.suggestedFilename(),
      phase,
    });
  };
  await openPanelSection(page, "captureSection");
  await page.selectOption("#exportScale", "1");
  await page.evaluate((baselineToken) => {
    if (!window.__finiteOpticalSubmissions)
      throw new Error("Optical GPU submission probe did not install");
    const toast = document.getElementById("toast");
    if (toast) toast.textContent = "";
    const readFrame = () =>
      window.__finiteOpticalSubmissions.snapshot().frame ?? {
        token: NaN,
        sample: NaN,
        lines: [],
      };
    const record = { save: null, request: null, ack: null };
    const onClick = (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("#savePngBtn")) {
        record.save = {
          atMs: performance.now(),
          trusted: event.isTrusted,
          priorFrameToken: baselineToken,
          hash: location.hash,
          gpu: window.__finiteOpticalSubmissions.snapshot(),
        };
      }
      if (event.target.closest("#exportCancelBtn")) {
        record.request = {
          atMs: performance.now(),
          trusted: event.isTrusted,
          modalVisible: !document
            .getElementById("exportModal")
            ?.classList.contains("hidden"),
          saveBusy: document.getElementById("savePngBtn")?.disabled === true,
          frame: readFrame(),
          progress: document.getElementById("exportProgress")?.textContent,
          detail: document.getElementById("exportDetail")?.textContent,
          gpu: window.__finiteOpticalSubmissions.snapshot(),
        };
      }
    };
    const observeAck = () => {
      if (!record.request || record.ack) return;
      const toast = document.getElementById("toast")?.textContent ?? "";
      const modalHidden = document
        .getElementById("exportModal")
        ?.classList.contains("hidden");
      const saveEnabled =
        document.getElementById("savePngBtn")?.disabled === false;
      if (toast === "Export cancelled" && modalHidden && saveEnabled) {
        record.ack = {
          atMs: performance.now(),
          toast,
          modalHidden,
          saveEnabled,
          frame: readFrame(),
          gpu: window.__finiteOpticalSubmissions.snapshot(),
        };
      }
    };
    const observer = new MutationObserver(observeAck);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    document.addEventListener("click", onClick, true);
    window.__finiteExportCancelProbe = {
      record,
      ready: () => {
        const frame = readFrame();
        const gpu = window.__finiteOpticalSubmissions.snapshot();
        return (
          record.save &&
          frame.token > record.save.priorFrameToken &&
          gpu.outstanding.some(
            (submission) =>
              submission.id > record.save.gpu.serial &&
              submission.token === frame.token &&
              submission.sample === frame.sample,
          )
        );
      },
      cleanup: () => {
        observer.disconnect();
        document.removeEventListener("click", onClick, true);
      },
    };
  }, priorToken);
  page.on("console", onConsole);
  page.on("download", onDownload);
  try {
    await page.click("#savePngBtn");
    await page.locator("#exportCancelBtn").waitFor({
      state: "visible",
      timeout: 60_000,
    });
    const button = await page.locator("#exportCancelBtn").boundingBox();
    if (!button) throw new Error(`${label}: export Cancel has no hit target`);
    await page.waitForFunction(
      () => window.__finiteExportCancelProbe.ready(),
      undefined,
      { timeout: 60_000, polling: "raf" },
    );
    // Premeasured target avoids an actionability wait after optical work was
    // observed. The capture-phase handler still rechecks at the actual click.
    await page.mouse.click(
      button.x + button.width / 2,
      button.y + button.height / 2,
    );
    await page.waitForFunction(
      () => window.__finiteExportCancelProbe.record.ack !== null,
      undefined,
      { timeout: 30_000, polling: "raf" },
    );
    const record = await page.evaluate(
      () => window.__finiteExportCancelProbe.record,
    );
    evidence.observation = record;
    evidence.ackMs = record.ack.atMs - record.request.atMs;
    evidence.requestFrame = traceFrames(record.request.frame.lines).at(-1);
    check(
      record.save.trusted &&
        record.request.trusted &&
        record.request.modalVisible &&
        record.request.saveBusy &&
        record.request.frame.token > record.save.priorFrameToken &&
        record.request.gpu.failures.length === 0 &&
        record.request.gpu.outstanding.some(
          (submission) =>
            submission.id > record.save.gpu.serial &&
            submission.token === record.request.frame.token &&
            submission.sample === record.request.frame.sample,
        ) &&
        evidence.requestFrame?.samples === finite.samples &&
        !evidence.requestFrame.completed,
      `${label}: trusted Cancel landed with an outstanding optical GPU submission from this export sample`,
    );
    check(
      record.request.detail?.startsWith(
        `${FINITE_VIEWPORT.width} × ${FINITE_VIEWPORT.height}`,
      ) &&
        (maxRays === null
          ? evidence.requestFrame?.rays ===
            FINITE_VIEWPORT.width * FINITE_VIEWPORT.height
          : evidence.requestFrame?.rays > 0 &&
            evidence.requestFrame.rays <= maxRays),
      `${label}: cancelled the requested full-canvas export in the expected tiling arm`,
    );
    check(
      evidence.ackMs >= 0 && evidence.ackMs <= EXPORT_CANCEL_LIMIT_MS,
      `${label}: trusted Cancel to toast/modal/button acknowledgement ${evidence.ackMs.toFixed(2)}ms <= ${EXPORT_CANCEL_LIMIT_MS}ms`,
    );
    // Record the first visible acknowledgement even if it was premature:
    // waiting for a later drain would conceal a UI that declared cleanup
    // while this export still held submitted GPU work.
    evidence.cleanupAtAcknowledgement =
      record.ack.gpu.failures.length === 0 &&
      !record.ack.gpu.outstanding.some(
        (submission) => submission.token === record.request.frame.token,
      );
    check(
      evidence.cleanupAtAcknowledgement,
      `${label}: the acknowledged export has no outstanding optical GPU submissions or fence errors`,
    );
    const beforeLive = await copiedLiveDocument(page);
    evidence.beforeInteraction = {
      ...beforeLive,
      camera: beforeLive.document.camera,
      token: Math.max(
        record.request.frame.token,
        ...traceFrames(evidence.trace)
          .map((frame) => frame.token)
          .filter(Number.isInteger),
      ),
    };
    const canvas = await page
      .locator("#container canvas")
      .first()
      .boundingBox();
    if (!canvas) throw new Error(`${label}: no canvas for post-cancel drag`);
    phase = "interaction";
    const x = canvas.x + canvas.width * 0.35;
    const y = canvas.y + canvas.height * 0.45;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 65, y + 25, { steps: 6 });
    await page.mouse.up();
    const recoveryDeadline = performance.now() + 90_000;
    while (performance.now() < recoveryDeadline) {
      evidence.interactionFrames = traceFrames(evidence.interactionTrace);
      const frame = evidence.interactionFrames.find(
        (candidate) =>
          candidate.token > evidence.beforeInteraction.token &&
          completedOpticalFrame(candidate),
      );
      if (frame) {
        const state = await page.evaluate(() => window.__surfaceState?.());
        if (
          state?.mode === "surface" &&
          state.engine === "compute" &&
          state.opticsBackend === "finiteSolid" &&
          state.firstFrame
        ) {
          evidence.recoveryFrame = frame;
          break;
        }
      }
      await page.waitForTimeout(100);
    }
    if (!evidence.recoveryFrame)
      throw new Error(
        `${label}: no fresh fully resolved optical frame after cancellation and drag`,
      );
    const afterLive = await copiedLiveDocument(page);
    evidence.afterInteraction = {
      ...afterLive,
      camera: afterLive.document.camera,
      state: await page.evaluate(() => window.__surfaceState?.()),
    };
    check(
      JSON.stringify(evidence.afterInteraction.camera) !==
        JSON.stringify(evidence.beforeInteraction.camera),
      `${label}: Copy Link carries the changed live camera after trusted drag`,
    );
    check(
      completedOpticalFrame(evidence.recoveryFrame),
      `${label}: a fresh untruncated camera frame resolved every positive optical hit after cancellation`,
    );
    check(
      evidence.downloads.length === 0,
      `${label}: cancelled export produced no download through the new camera frame`,
    );
    evidence.complete = true;
    return evidence;
  } finally {
    try {
      evidence.observation = await page.evaluate(() => {
        const probe = window.__finiteExportCancelProbe;
        probe?.cleanup();
        delete window.__finiteExportCancelProbe;
        return probe?.record ?? null;
      });
    } catch (error) {
      evidence.cleanupError = error.message;
    }
    page.off("console", onConsole);
    page.off("download", onDownload);
  }
}

/** Init-script accounting observes declared WebGPU buffer lifetimes. Binding
 * identities locate optical buffers independently of minified names/labels.
 * This does not measure physical VRAM or implementation-private allocations. */
function installGpuBufferCensus() {
  if (!globalThis.GPUDevice || !globalThis.GPUBuffer) return;
  const buffers = new Map();
  const identities = new WeakMap();
  const devices = new WeakMap();
  const events = [];
  let nextDevice = 0;
  let nextBuffer = 0;
  let liveBytes = 0;
  let highWaterBytes = 0;
  const deviceId = (device) => {
    if (!devices.has(device)) devices.set(device, ++nextDevice);
    return devices.get(device);
  };
  const release = (record, reason) => {
    if (!record || !record.live) return;
    record.live = false;
    liveBytes -= record.bytes;
    events.push({
      atMs: performance.now(),
      operation: reason,
      id: record.id,
      liveBytes,
    });
  };
  const createBuffer = GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createBuffer = function (descriptor) {
    const buffer = createBuffer.call(this, descriptor);
    const record = {
      id: ++nextBuffer,
      device: deviceId(this),
      bytes: buffer.size,
      requestedBytes: Number(descriptor.size),
      usage: buffer.usage,
      label: String(descriptor.label ?? ""),
      live: true,
      role:
        descriptor.label === "finite-transport-running"
          ? "finite-transport-running"
          : null,
    };
    identities.set(buffer, record);
    buffers.set(record.id, record);
    liveBytes += record.bytes;
    highWaterBytes = Math.max(highWaterBytes, liveBytes);
    events.push({
      atMs: performance.now(),
      operation: "create",
      ...record,
      liveBytes,
    });
    return buffer;
  };
  const destroyBuffer = GPUBuffer.prototype.destroy;
  GPUBuffer.prototype.destroy = function () {
    const result = destroyBuffer.call(this);
    release(identities.get(this), "buffer-destroy");
    return result;
  };
  const destroyDevice = GPUDevice.prototype.destroy;
  GPUDevice.prototype.destroy = function () {
    const result = destroyDevice.call(this);
    for (const record of buffers.values()) {
      if (record.device === devices.get(this))
        release(record, "device-destroy");
    }
    return result;
  };
  const createBindGroup = GPUDevice.prototype.createBindGroup;
  GPUDevice.prototype.createBindGroup = function (descriptor) {
    const group = createBindGroup.call(this, descriptor);
    const binding = (index) =>
      identities.get(
        [...descriptor.entries].find((entry) => entry.binding === index)
          ?.resource?.buffer,
      );
    const maps = binding(13);
    const state = binding(14);
    const status = binding(15);
    // Both finite variants bind the same shared shade uniform at 4 and the
    // layer output at 9. Its optical tail is the only legitimate shared
    // buffer-size difference in the paired document (224 -> 256 bytes).
    if (binding(0) && binding(4) && binding(9))
      binding(4).sharedRole = "shade-uniform";
    if (maps && state && status) {
      maps.role = "optics-maps";
      state.role = "transport-state";
      status.role = "transport-status";
      // Binding 1 is normally plain maps. Only the named finite work
      // allocation bound beside the actual transport buffers is scratch.
      const work = binding(1);
      if (work?.label === "finite-transport-work") {
        work.role = "finite-transport-work";
        work.boundAt1 = true;
      }
      const staging = [...buffers.values()].findLast(
        (record) =>
          record.live &&
          record.device === status.device &&
          record.id > status.id &&
          record.bytes === status.bytes &&
          record.usage === (GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST),
      );
      if (staging) staging.role = "transport-staging";
    }
    return group;
  };
  window.__finiteGpuBufferCensus = {
    snapshot: (includeHistory = false) => {
      const live = [...buffers.values()].filter((record) => record.live);
      const roleBytes = Object.fromEntries(
        [
          "optics-maps",
          "transport-state",
          "transport-status",
          "transport-staging",
          "finite-transport-work",
          "finite-transport-running",
        ].map((role) => [
          role,
          live
            .filter((record) => record.role === role)
            .reduce((sum, record) => sum + record.bytes, 0),
        ]),
      );
      return {
        liveBytes,
        highWaterBytes,
        live,
        roleBytes,
        opticalLiveBytes: Object.values(roleBytes).reduce(
          (sum, bytes) => sum + bytes,
          0,
        ),
        ...(includeHistory ? { events, records: [...buffers.values()] } : {}),
      };
    },
  };
}

function summarizeRssSamples(samples) {
  const values = samples
    .filter((sample) => sample.status === "ok")
    .map((sample) => sample.rssBytes)
    .sort((a, b) => a - b);
  const complete = samples.length > 0 && values.length === samples.length;
  return {
    status: complete
      ? "ok"
      : samples.some((sample) => sample.status === "partial")
        ? "partial"
        : "unknown",
    samples: samples.length,
    minBytes: complete ? values[0] : null,
    medianBytes: complete ? values[Math.floor(values.length / 2)] : null,
    maxBytes: complete ? values.at(-1) : null,
    knownMaxBytes: Math.max(
      0,
      ...samples.map((sample) => sample.knownRssBytes ?? 0),
    ),
  };
}

/** Compare corresponding retained phases, not unrelated allocation peaks.
 * Every declared live buffer participates, including unlabelled allocations.
 * The optical shader's 32-byte uniform tail is separate from the role census. */
function pairedDeclaredGpuBuffers(opaque, glass) {
  return ["live", "repeat1", "repeat2"].map((phase) => {
    const a = opaque?.gpu?.[phase];
    const b = glass?.gpu?.[phase];
    const errors = [];
    const valid = (snapshot) =>
      snapshot &&
      Number.isSafeInteger(snapshot.liveBytes) &&
      snapshot.liveBytes >= 0 &&
      Array.isArray(snapshot.live) &&
      snapshot.live.every(
        (record) => Number.isSafeInteger(record.bytes) && record.bytes >= 0,
      ) &&
      snapshot.live.reduce((sum, record) => sum + record.bytes, 0) ===
        snapshot.liveBytes;
    if (!valid(a) || !valid(b))
      return {
        phase,
        errors: ["missing or inconsistent total live-buffer census"],
      };
    const uniforms = (snapshot) =>
      snapshot.live.filter((record) => record.sharedRole === "shade-uniform");
    const au = uniforms(a);
    const bu = uniforms(b);
    if (
      au.length !== 1 ||
      bu.length !== 1 ||
      au[0]?.bytes !== 224 ||
      bu[0]?.bytes !== 256
    )
      errors.push(
        "unexpected shared shade-uniform allocation (expected 224/256 bytes)",
      );
    const shared = (snapshot) =>
      snapshot.live
        .filter(
          (record) => !record.role && record.sharedRole !== "shade-uniform",
        )
        .map((record) => `${record.usage}:${record.bytes}`)
        .sort();
    if (JSON.stringify(shared(a)) !== JSON.stringify(shared(b)))
      errors.push(
        "unattributed shared/unlabelled live-buffer allocations differ",
      );
    const totalDeltaBytes = b.liveBytes - a.liveBytes;
    const recognizedOpticalDeltaBytes = b.opticalLiveBytes - a.opticalLiveBytes;
    const expectedSharedDeltaBytes = 32;
    const unattributedDeltaBytes =
      totalDeltaBytes - recognizedOpticalDeltaBytes - expectedSharedDeltaBytes;
    if (
      !Number.isSafeInteger(recognizedOpticalDeltaBytes) ||
      unattributedDeltaBytes !== 0
    )
      errors.push(
        "total allocation delta is not fully explained by optical buffers and the uniform tail",
      );
    if (totalDeltaBytes < 0 || totalDeltaBytes > RETAINED_RENDER_LIMIT_BYTES)
      errors.push(
        "total additional declared GPU buffers exceed the retained-memory limit",
      );
    return {
      phase,
      opaqueLiveBytes: a.liveBytes,
      glassLiveBytes: b.liveBytes,
      totalDeltaBytes,
      recognizedOpticalDeltaBytes,
      expectedSharedDeltaBytes,
      unattributedDeltaBytes,
      limitBytes: RETAINED_RENDER_LIMIT_BYTES,
      errors,
    };
  });
}

/** Fresh canonical history only: warm pipelines at 256x144, release their buffers,
 * sample the controls plateau, then retain full-HD state through two saves.
 * Trace and procfs rows stream to disk, avoiding observer string accumulation
 * inside the RSS measurement. Encoding is a separate watch phase. */
async function runFiniteMemoryArm(ctx, label, authored, optics, evidence) {
  const page = await ctx.newPage();
  const stem = `${authored.preset}-${optics ? "glass" : "opaque"}-memory`;
  const rawPath = `${FINITE_OUT}/${stem}-rss.jsonl`;
  const tracePath = `${FINITE_OUT}/${stem}-trace.log`;
  const raw = createWriteStream(rawPath);
  const traceFile = createWriteStream(tracePath);
  let streamError = null;
  raw.on("error", (error) => {
    streamError = error;
  });
  traceFile.on("error", (error) => {
    streamError = error;
  });
  let phase = "boot";
  let stop = false;
  const started = performance.now();
  evidence.rawRss = rawPath;
  evidence.traceFile = tracePath;
  evidence.frames = [];
  evidence.gpu = {};
  evidence.exports = [];
  evidence.transportBatches = {
    count: 0,
    maxWallMs: 0,
    maxPerFrame: 0,
    logicalNumberPayloadBytes: 0,
  };
  evidence.observer = {
    rssIntervalMs: 100,
    traceStorage:
      "streamed to disk; only compact frame summaries retained during measurement",
    scope:
      "Node launcher plus browser descendants; RSS includes the sampler and bounded stream buffers",
  };
  const monitor = (async () => {
    while (!stop) {
      const sampledPhase = phase;
      const sample = await sampleProcessTreeRss(process.pid);
      raw.write(
        `${JSON.stringify({ atMs: performance.now() - started, phase: sampledPhase, ...sample })}\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  let frameLines = [];
  let framePhase = null;
  let frameBatches = 0;
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[surfacetrace] ")) {
      const line = text.slice("[surfacetrace] ".length);
      traceFile.write(`${phase} ${line}\n`);
      if (line.includes("frame start ")) {
        frameLines = [line];
        framePhase = phase;
        frameBatches = 0;
      } else if (
        line.includes("transport done final ") ||
        line.includes("transport failures ")
      )
        frameLines.push(line);
      else if (line.includes("frame done ")) {
        frameLines.push(line);
        evidence.frames.push({
          phase: framePhase,
          transportBatches: frameBatches,
          ...traceFrames(frameLines)[0],
        });
        evidence.transportBatches.maxPerFrame = Math.max(
          evidence.transportBatches.maxPerFrame,
          frameBatches,
        );
        evidence.transportBatches.logicalNumberPayloadBytes =
          evidence.transportBatches.maxPerFrame * 8;
        frameLines = [];
      }
      const batch = /transport pass=\d+ batch=\d+ wallMs=([\d.]+)/.exec(line);
      if (batch) {
        frameBatches++;
        evidence.transportBatches.count++;
        evidence.transportBatches.maxWallMs = Math.max(
          evidence.transportBatches.maxWallMs,
          Number(batch[1]),
        );
      }
    } else if (text.startsWith("Surface compute export tile ")) {
      traceFile.write(`${phase} ${text}\n`);
      const tile = /tile (\d+)\/(\d+)/.exec(text);
      if (tile && tile[1] === tile[2] && phase.startsWith("render-export-"))
        phase = phase.replace("render-export-", "presentation-encoding-");
    }
  });
  page.on("pageerror", (error) => check(false, `${label}: ${error.message}`));
  const snapshot = async (name) => {
    evidence.gpu[name] = await page.evaluate(
      () => window.__finiteGpuBufferCensus?.snapshot() ?? null,
    );
    if (!evidence.gpu[name])
      throw new Error(`${label}: GPU allocation census did not install`);
  };
  const settle = async (raster) => {
    await page.waitForFunction(
      () => window.__surfaceState?.().settled === true,
      undefined,
      { timeout: SETTLE_TIMEOUT_MS },
    );
    const state = await page.evaluate(() => window.__surfaceState());
    check(
      state.engine === "compute" && namedHardware(state.backend),
      `${label}: named hardware compute renderer`,
    );
    if (optics)
      check(
        state.opticsBackend === "finiteSolid",
        `${label}: exact finite optical backend`,
      );
    check(
      state.census?.rays === raster.width * raster.height,
      `${label}: actual ${raster.width}x${raster.height} live raster`,
    );
    evidence.settledState = state;
  };
  try {
    const warmupRaster = { width: 256, height: 144 };
    evidence.warmupRaster = warmupRaster;
    await page.setViewportSize(warmupRaster);
    await page.addInitScript(installGpuBufferCensus);
    await page.goto(
      `${BASE}/?surfacestate&surfacetrace&memory=${optics ? "glass" : "opaque"}${authored.hash}`,
      { waitUntil: "load" },
    );
    await page.waitForFunction(
      () => typeof window.__surfaceState === "function",
      undefined,
      { timeout: 60_000 },
    );
    phase = "warmup";
    await page.waitForFunction(
      () => !document.getElementById("modeSurfaceBtn")?.disabled,
      undefined,
      { timeout: 60_000 },
    );
    await page.$eval("#modeSurfaceBtn", (button) => button.click());
    await settle(warmupRaster);
    await snapshot("warmup");
    phase = "warmup-release";
    await page.$eval("#modePointsBtn", (button) => button.click());
    await page.waitForFunction(
      () => window.__finiteGpuBufferCensus?.snapshot().liveBytes === 0,
      undefined,
      { timeout: 30_000 },
    );
    await snapshot("warmupReleased");
    await page.setViewportSize(FINITE_VIEWPORT);
    if (
      !(await page.$eval("#panel", (panel) => panel.classList.contains("open")))
    )
      await page.click("#menuToggle");
    // Only the small warmup's garbage is collected. Never collect during a
    // measured render or after an encode to manufacture a low RSS sample.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.detach();
    evidence.gcBeforeBaseline = {
      method: "CDP HeapProfiler.collectGarbage",
      warmupRaster,
      duringMeasuredWork: false,
    };
    phase = "controls";
    await page.waitForTimeout(1_200);
    await snapshot("controls");
    phase = "render-live";
    await page.$eval("#modeSurfaceBtn", (button) => button.click());
    await settle(FINITE_VIEWPORT);
    phase = "render-retained";
    await page.waitForTimeout(1_200);
    await snapshot("live");
    await openPanelSection(page, "captureSection");
    await page.selectOption("#exportScale", "1");
    for (const repeat of [1, 2]) {
      phase = `render-export-${repeat}`;
      const promise = page.waitForEvent("download", {
        timeout: EXPORT_TIMEOUT_MS,
      });
      const t0 = performance.now();
      const [, download] = await Promise.all([
        page.click("#savePngBtn"),
        promise,
      ]);
      const file = await download.path();
      const clickToDownloadMs = performance.now() - t0;
      const bytes = await readFile(file);
      const dimensions = pngDimensions(bytes);
      const png = `${FINITE_OUT}/${stem}-${repeat}.png`;
      await writeFile(png, bytes);
      check(
        dimensions?.width === 1920 && dimensions.height === 1080,
        `${label} repeat ${repeat}: actual 1920x1080 PNG`,
      );
      evidence.exports.push({
        repeat,
        png,
        dimensions,
        clickToDownloadMs,
        sha256: sha256(bytes),
      });
      phase = `post-encoding-${repeat}`;
      await page.waitForTimeout(1_200);
      await snapshot(`repeat${repeat}`);
    }
    // Observe renderer destruction while the census is still reachable.
    // Closing a page alone would hide whether these allocations were freed.
    phase = "measured-release";
    await page.$eval("#modePointsBtn", (button) => button.click());
    await page.waitForFunction(
      () => window.__finiteGpuBufferCensus?.snapshot().liveBytes === 0,
      undefined,
      { timeout: 30_000 },
    );
    await snapshot("measuredReleased");
    evidence.gpuHistory = await page.evaluate(() =>
      window.__finiteGpuBufferCensus.snapshot(true),
    );
    evidence.complete = true;
  } finally {
    phase = "cleanup";
    stop = true;
    await monitor;
    if (!evidence.gpuHistory)
      evidence.gpuHistory = await page
        .evaluate(() => window.__finiteGpuBufferCensus?.snapshot(true) ?? null)
        .catch(() => null);
    raw.end();
    traceFile.end();
    await Promise.all([finished(raw), finished(traceFile)]);
    await page.close();
    if (streamError) throw streamError;
    const samples = (await readFile(rawPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const phaseRequirements = {
      controls: 8,
      "render-live": 1,
      "render-export-1": 1,
      "render-export-2": 1,
      "render-retained": 8,
      "post-encoding-1": 8,
      "post-encoding-2": 8,
    };
    evidence.rss = {
      phases: Object.fromEntries(
        [
          ...new Set([
            ...samples.map((sample) => sample.phase),
            ...Object.keys(phaseRequirements),
          ]),
        ].map((name) => [
          name,
          summarizeRssSamples(
            samples.filter((sample) => sample.phase === name),
          ),
        ]),
      ),
      phaseRequirements,
      qualificationFailures: [],
      scope:
        "Observed process-tree host RSS. Warmup and presentation/encoding remain watch phases; no VRAM/driver-private measurement and no addition to declared GPU bytes.",
    };
    for (const [name, minimumSamples] of Object.entries(phaseRequirements)) {
      const observed = evidence.rss.phases[name];
      if (observed.status !== "ok" || observed.samples < minimumSamples)
        evidence.rss.qualificationFailures.push(
          `${name}: ${observed.samples}/${minimumSamples} required samples, status=${observed.status}`,
        );
    }
    // The frozen line observes retained rendering after pipeline warmup.
    // Keep excluded-phase sampling gaps visible without treating an unknown
    // boot/encoding watch observation as missing render-phase evidence.
    evidence.rss.excludedPhaseObservationGaps = samples
      .filter(
        (sample) =>
          !Object.hasOwn(phaseRequirements, sample.phase) &&
          sample.status !== "ok",
      )
      .map((sample) => ({ phase: sample.phase, status: sample.status }));
    evidence.rss.status =
      evidence.rss.qualificationFailures.length === 0 ? "ok" : "unqualified";
    const render = summarizeRssSamples(
      samples.filter((sample) => sample.phase.startsWith("render-")),
    );
    const controls = evidence.rss.phases.controls;
    evidence.rss.render = render;
    evidence.rss.retainedRenderAboveControlsBytes =
      evidence.rss.status === "ok" && render.status === "ok"
        ? render.maxBytes - controls.medianBytes
        : null;
    evidence.rss.plateauGrowth = {
      before: evidence.rss.phases["render-retained"],
      afterFirst: evidence.rss.phases["post-encoding-1"],
      afterSecond: evidence.rss.phases["post-encoding-2"],
    };
    evidence.transportBatches.note =
      "Eight bytes per logical JS number is a payload count only; array backing capacity/object overhead is observed through RSS, not certified by this multiplication.";
  }
  const snapshots = [
    evidence.gpu.live,
    evidence.gpu.repeat1,
    evidence.gpu.repeat2,
  ];
  const capacities = snapshots.map(
    (gpu) => gpu.roleBytes["transport-state"] / 32,
  );
  const capacity = Math.max(...capacities);
  const slots = snapshots[0].roleBytes["optics-maps"] / 32;
  // Intentionally independent from finite-transport-work.ts: this browser
  // census must catch a changed allocation/layout, not share its arithmetic.
  const scratchBytes = (rays) => 16 + 2736 * Math.min(rays, 4096);
  evidence.opticalAccounting = {
    formula:
      "40*C + 32*slots + 16 + 2736*min(C,4096) + 4: records/status/staging/materials plus one batch scratch and running-count staging",
    capacity,
    slots,
    scratchCapacity: optics ? Math.min(capacity, 4096) : 0,
    expectedScratchBytes: optics ? scratchBytes(capacity) + 4 : 0,
    expectedBytes: optics
      ? 40 * capacity + 32 * slots + scratchBytes(capacity) + 4
      : 0,
    observedBytes: snapshots.map((gpu) => gpu.opticalLiveBytes),
    frameRayHighWater: Math.max(...evidence.frames.map((frame) => frame.rays)),
    repeatedDeclaredLiveBytes: snapshots.map((gpu) => gpu.liveBytes),
    highWaterScope:
      "Fresh canonical full-HD history only. A prior larger raster retains its larger C; 4M-ray optical buffers alone exceed 128 MiB. One batch-limited stack allocation serves all AA samples and repeated live/export renders; no full-image stack or AA/export multiplication.",
  };
  check(
    snapshots.every((gpu) => {
      const rays = gpu.roleBytes["transport-state"] / 32;
      const expected = optics
        ? {
            "optics-maps": 32,
            "transport-state": 32 * rays,
            "transport-status": 4 * rays,
            "transport-staging": 4 * rays,
            "finite-transport-work": scratchBytes(rays),
            "finite-transport-running": 4,
          }
        : Object.fromEntries(
            Object.keys(gpu.roleBytes).map((role) => [role, 0]),
          );
      return (
        (!optics || (Number.isSafeInteger(rays) && rays >= 1920 * 1080)) &&
        Object.entries(expected).every(([role, bytes]) => {
          const records = gpu.live.filter((record) => record.role === role);
          return (
            gpu.roleBytes[role] === bytes &&
            records.length === (optics ? 1 : 0) &&
            (role !== "finite-transport-work" ||
              !optics ||
              records[0].boundAt1 === true)
          );
        }) &&
        gpu.opticalLiveBytes ===
          Object.values(expected).reduce((sum, bytes) => sum + bytes, 0)
      );
    }),
    `${label}: declared optical buffers independently match every size/count, including one bounded finite scratch and 4-byte running staging`,
  );
  check(
    evidence.gpu.warmupReleased?.liveBytes === 0 &&
      evidence.gpu.measuredReleased?.liveBytes === 0 &&
      (!optics ||
        ["finite-transport-work", "finite-transport-running"].every((name) => {
          const records =
            evidence.gpuHistory?.records.filter(
              (record) => record.label === name,
            ) ?? [];
          return (
            records.length >= 2 &&
            records.every((record) => record.live === false)
          );
        })),
    `${label}: warmup and measured continuation buffers were released with their renderer`,
  );
  check(
    snapshots.every((gpu) => gpu.liveBytes === snapshots[0].liveBytes),
    `${label}: repeated exports retain the same declared GPU buffer bytes`,
  );
  check(
    !optics || (capacity >= 1920 * 1080 && slots === 1),
    `${label}: optical capacity covers full-HD and the finite head uses its one material slot`,
  );
  evidence.jobs = {};
  for (const phase of ["render-live", "render-export-1", "render-export-2"]) {
    // One-sample live previews are separate work. Every four-AA frame in
    // this phase must belong to its one complete job; retries cannot donate
    // samples to another export or conceal a missing sample.
    const frames = evidence.frames.filter(
      (frame) => frame.phase === phase && frame.samples === 4,
    );
    const tokens = [...new Set(frames.map((frame) => frame.token))];
    const errors = [];
    if (
      frames.length !== 4 ||
      tokens.length !== 1 ||
      !Number.isInteger(tokens[0])
    )
      errors.push("expected one identified four-sample job");
    if (optics) {
      errors.push(...completionFailures(frames, 4, 1920 * 1080));
    } else {
      for (const [sample, frame] of frames.entries()) {
        if (
          frame.sample !== sample ||
          frame.token !== tokens[0] ||
          frame.rays !== 1920 * 1080 ||
          !frame.completed ||
          frame.truncated ||
          frame.active !== 0 ||
          frame.exhausted !== 0 ||
          frame.hit <= 0 ||
          frame.hit +
            frame.miss +
            frame.plane +
            frame.exhausted +
            frame.active !==
            frame.rays ||
          frame.tallies.length !== 0
        )
          errors.push(`sample ${sample}: incomplete opaque primary accounting`);
      }
    }
    evidence.jobs[phase] = { token: tokens[0] ?? null, frames, errors };
    check(
      errors.length === 0,
      `${label} ${phase}: strict complete full-HD four-AA job (${errors.join("; ") || "positive hits in every sample"})`,
    );
  }
  check(
    evidence.rss.status === "ok" &&
      evidence.rss.retainedRenderAboveControlsBytes !== null,
    `${label}: complete procfs observations in every render phase and repeated controls/retained plateaus (${evidence.rss.qualificationFailures.join("; ") || "all required phases observed"})`,
  );
  return evidence;
}

/** One arm: load the pinned scene, enter Surface, settle, Save PNG.
 * Resolves the PNG bytes plus what the run disclosed about itself. */
async function runArm(
  ctx,
  label,
  maxRays,
  scene = SCENE,
  watchTransport = false,
  finite = null,
) {
  const page = await ctx.newPage();
  try {
    if (finite) await page.setViewportSize(FINITE_VIEWPORT);
    if (finite && CANCEL_ONLY)
      await page.addInitScript(installOpticalSubmissionProbe);
    const tiles = [];
    let computeActive = false;
    let fitted = false;
    let transportLines = 0;
    let latestFrameToken = null;
    let exporting = false;
    const exportTrace = [];
    if (finite) finite.evidence.exportTrace = exportTrace;
    page.on("console", (m) => {
      const t = m.text();
      if (t.includes("frame start "))
        latestFrameToken = Number(/ token=(\d+)/.exec(t)?.[1]);
      if (finite && exporting) {
        if (t.startsWith("[surfacetrace] ")) {
          exportTrace.push(t.slice("[surfacetrace] ".length));
        } else if (t.startsWith("Surface compute export tile ")) {
          exportTrace.push(t);
        }
      }
      if (t.includes("WebGPU compute tracer active")) computeActive = true;
      if (watchTransport && t.includes("transport pass=")) transportLines += 1;
      // The live pane's own fit under the same device ray ceiling — a
      // capture tiles, a live frame cannot, so it traces smaller and blits
      // up, disclosing itself once per session.
      if (/^Surface compute: tracing \d+x\d+ for a/.test(t)) fitted = true;
      const tile = /Surface compute export tile (\d+)\/(\d+)/.exec(t);
      if (tile) tiles.push(Number(tile[2]));
    });
    page.on("pageerror", (e) => {
      check(false, `${label}: page error ${e.message}`);
    });
    const query =
      (maxRays === null
        ? "surfacestate"
        : `surfacestate&surfacemaxrays=${String(maxRays)}`) +
      (watchTransport ? "&surfacetrace" : "");
    await page.goto(`${BASE}/?${query}${scene}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__surfaceState !== undefined, {
      timeout: 60_000,
    });
    await page.waitForTimeout(2_000);

    await page.click("#modeSurfaceBtn");
    const t0 = Date.now();
    let settled = false;
    while (Date.now() - t0 < SETTLE_TIMEOUT_MS) {
      await page.waitForTimeout(SETTLE_POLL_MS);
      settled = await page.evaluate(
        () => window.__surfaceState?.().settled === true,
      );
      if (settled) break;
    }
    check(
      settled,
      `${label}: settled (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    check(computeActive, `${label}: ran the WebGPU compute tracer`);
    const settledState = finite
      ? await page.evaluate(() => window.__surfaceState?.() ?? null)
      : null;
    if (finite) {
      finite.evidence.settledState = settledState;
      check(
        settledState?.engine === "compute" &&
          settledState?.opticsBackend === "finiteSolid",
        `${label}: actual compute / finiteSolid route`,
      );
      if (DISPLAY) {
        check(
          namedHardware(settledState?.backend),
          `${label}: named hardware adapter (${settledState?.backend?.label ?? "missing"})`,
        );
      }
      if (!settled)
        throw new Error(`${label}: no completed live frame before export`);
    }

    if (finite && CANCEL_ONLY) {
      if (!Number.isInteger(latestFrameToken))
        throw new Error(`${label}: no prior live frame token before export`);
      const cancellation = await cancelFiniteExport(
        page,
        label,
        finite,
        maxRays,
        latestFrameToken,
      );
      return { bytes: null, fitted, settledState, cancellation };
    }

    if (!finite) {
      // Presentation-only DoF must change the retained frame without disturbing
      // the settled trace, and disabling it must recover the legacy image. This
      // runs before Save PNG so both tiling arms export the feature under test.
      const canvas = page.locator("canvas").first();
      const dofOff = await canvas.screenshot({ type: "png" });
      await page.$eval("#surfaceDepthOfFieldCheckbox", (input) => {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(500);
      check(
        await page.evaluate(() => window.__surfaceState?.().settled === true),
        `${label}: enabling DoF did not restart the settled trace`,
      );
      const dofOn = await canvas.screenshot({ type: "png" });
      const dofDiff = await comparePngs(page, dofOff, dofOn);
      check(
        !dofDiff.other && dofDiff.meanDiff > 0.01,
        `${label}: DoF changed retained pixels (mean ${dofDiff.meanDiff?.toFixed(4) ?? "n/a"}/255)`,
      );

      await page.$eval("#surfaceDepthOfFieldCheckbox", (input) => {
        input.checked = false;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(250);
      const dofOffAgain = await canvas.screenshot({ type: "png" });
      const identityDiff = await comparePngs(page, dofOff, dofOffAgain);
      check(
        !identityDiff.other && identityDiff.meanDiff < 0.02,
        `${label}: disabling DoF restored the legacy frame (mean ${identityDiff.meanDiff?.toFixed(4) ?? "n/a"}/255)`,
      );

      // Re-enable and edit only the live backdrop. The settled bit must remain
      // true while the shared blit recomposes every tap at its own radial UV.
      await page.$eval("#surfaceDepthOfFieldCheckbox", (input) => {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.$eval("#background", (select) => {
        select.value = "haze";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.$eval("#backgroundShape", (select) => {
        select.value = "radial";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(500);
      check(
        await page.evaluate(() => window.__surfaceState?.().settled === true),
        `${label}: radial background edit with DoF did not retrace`,
      );
    }

    await openPanelSection(page, "captureSection");
    if (finite) {
      await page.selectOption("#exportScale", "1");
      finite.evidence.captureRaster = await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        devicePixelRatio,
        exportScale: Number(document.getElementById("exportScale")?.value),
        canvases: [...document.querySelectorAll("#container canvas")].map(
          (canvas) => ({
            width: canvas.width,
            height: canvas.height,
            cssWidth: canvas.getBoundingClientRect().width,
            cssHeight: canvas.getBoundingClientRect().height,
          }),
        ),
      }));
    }
    await page.locator("#savePngBtn").scrollIntoViewIfNeeded();
    const dl = page.waitForEvent("download", { timeout: EXPORT_TIMEOUT_MS });
    const c0 = performance.now();
    exporting = true;
    let bytes = null;
    let clickToDownloadMs = null;
    try {
      const [, download] = await Promise.all([page.click("#savePngBtn"), dl]);
      const file = await download.path();
      clickToDownloadMs = performance.now() - c0;
      bytes = await readFile(file);
    } catch (err) {
      check(false, `${label}: Save PNG produced a download (${err.message})`);
    }
    const exportTiming = {
      clickToDownloadMs,
      observedMs: performance.now() - c0,
      complete: bytes !== null,
      limitMs:
        finite && QUALIFY_FULL_HD && maxRays === null
          ? FULL_HD_EXPORT_LIMIT_MS
          : null,
      scope:
        maxRays === null ? "normal default export" : "artificial-band stress",
      forcedMaxRays: maxRays,
      watchdogMs: EXPORT_TIMEOUT_MS,
      clock:
        "monotonic; immediately before trusted click to completed download.path()",
    };
    const actualPngDimensions = bytes ? pngDimensions(bytes) : null;
    if (finite) {
      Object.assign(finite.evidence, { exportTiming, actualPngDimensions });
      check(
        actualPngDimensions?.width === FINITE_VIEWPORT.width &&
          actualPngDimensions?.height === FINITE_VIEWPORT.height,
        `${label}: 1x PNG is the full ${FINITE_VIEWPORT.width}x${FINITE_VIEWPORT.height} canvas (${JSON.stringify(actualPngDimensions)})`,
      );
      if (QUALIFY_FULL_HD && maxRays === null) {
        check(
          bytes !== null &&
            clickToDownloadMs !== null &&
            clickToDownloadMs <= FULL_HD_EXPORT_LIMIT_MS,
          `${label}: default Full HD 4-AA click-to-download ${clickToDownloadMs?.toFixed(1) ?? "incomplete"}ms <= ${FULL_HD_EXPORT_LIMIT_MS}ms`,
        );
      } else if (QUALIFY_FULL_HD) {
        console.error(
          `[export-tile] ${label}: artificial-band stress (${maxRays} rays) click-to-download ${clickToDownloadMs?.toFixed(1) ?? "incomplete"}ms; complete rendering and pixel identity required, timing recorded separately from the default export limit`,
        );
      }
    }
    check(
      bytes !== null,
      `${label}: exported (${(exportTiming.observedMs / 1000).toFixed(1)}s, ` +
        `${bytes === null ? "no file" : `${(bytes.length / 1024).toFixed(0)}KB`})`,
    );
    exporting = false;
    const bands = finite
      ? finiteExportBands(exportTrace, finite.samples, label)
      : [];
    if (finite) {
      finite.evidence.bands = bands;
      const batches = exportTrace
        .filter((line) => line.includes("transport pass="))
        .map((line) => Number(/ wallMs=([^ ]+)/.exec(line)?.[1]));
      const valid =
        batches.length > 0 &&
        batches.every((ms) => Number.isFinite(ms) && ms >= 0);
      const maxWallMs = valid
        ? batches.reduce((maximum, ms) => Math.max(maximum, ms), 0)
        : null;
      finite.evidence.transportCheckpoints = {
        count: batches.length,
        maxWallMs,
        above600Ms: batches.filter((ms) => ms > EXPORT_CANCEL_LIMIT_MS).length,
        limitMs:
          QUALIFY_FULL_HD && maxRays === null ? EXPORT_CANCEL_LIMIT_MS : null,
        scope:
          maxRays === null
            ? "default export: every observed transport submission"
            : "artificial-band stress: observed transport submissions",
      };
      check(valid, `${label}: complete finite transport checkpoint timings`);
      if (QUALIFY_FULL_HD && maxRays === null)
        check(
          maxWallMs !== null && maxWallMs <= EXPORT_CANCEL_LIMIT_MS,
          `${label}: default Full HD transport checkpoint ${maxWallMs ?? "missing"}ms <= ${EXPORT_CANCEL_LIMIT_MS}ms`,
        );
    }
    return {
      bytes,
      fitted,
      tiles: tiles.length === 0 ? 0 : tiles[0],
      tileLines: tiles.length,
      transportLines,
      ...(finite
        ? {
            settledState,
            bands,
            exportTrace,
            exportTiming,
            actualPngDimensions,
          }
        : {}),
    };
  } finally {
    await page.close();
  }
}

/** Decode two PNGs in the browser (no image dependency in this repo) and
 * report how far apart they are. */
async function comparePngs(page, a, b) {
  return page.evaluate(
    async ([aB64, bB64]) => {
      const decode = async (b64) => {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const bitmap = await createImageBitmap(
          new Blob([buf], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const g = canvas.getContext("2d");
        g.drawImage(bitmap, 0, 0);
        return g.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const x = await decode(aB64);
      const y = await decode(bB64);
      if (x.width !== y.width || y.height !== x.height) {
        return {
          width: x.width,
          height: x.height,
          other: `${y.width}x${y.height}`,
        };
      }
      let sum = 0;
      let max = 0;
      let over8 = 0;
      let alphaDifferences = 0;
      const px = x.width * x.height;
      for (let i = 0; i < px; i++) {
        let worst = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(x.data[i * 4 + c] - y.data[i * 4 + c]);
          sum += d;
          if (d > worst) worst = d;
        }
        if (worst > max) max = worst;
        if (worst > 8) over8++;
        if (x.data[i * 4 + 3] !== y.data[i * 4 + 3]) alphaDifferences++;
      }
      return {
        width: x.width,
        height: x.height,
        meanDiff: sum / (px * 3),
        maxDiff: max,
        over8: over8 / px,
        alphaDifferences,
      };
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

async function main() {
  const scene =
    args.scene ?? (CANCEL_ONLY || MEMORY_ONLY ? "finite" : "boxfold");
  const runBoxfold =
    !CANCEL_ONLY && !MEMORY_ONLY && (scene === "boxfold" || scene === "all");
  const runTransmission =
    !CANCEL_ONLY &&
    !MEMORY_ONLY &&
    (scene === "transmission" || scene === "all");
  const runFinite = scene === "finite" || scene === "all";
  const finiteReport = {
    startedAt: new Date().toISOString(),
    mode: MEMORY_ONLY
      ? "memory-only"
      : CANCEL_ONLY
        ? "cancellation-only"
        : "saved-png-identity",
    url: BASE,
    display: DISPLAY ?? null,
    viewport: FINITE_VIEWPORT,
    overrides: {
      viewport: args.viewport === undefined ? null : FINITE_VIEWPORT,
      antialiasSamples: FINITE_SAMPLES,
    },
    maxRays: MAX_RAYS,
    freshDist: null,
    quietBaseline: null,
    timingCertified: false,
    fullHdQualification: {
      requested: QUALIFY_FULL_HD && !CANCEL_ONLY && !MEMORY_ONLY,
      limitMs: FULL_HD_EXPORT_LIMIT_MS,
      verdict:
        QUALIFY_FULL_HD && !CANCEL_ONLY && !MEMORY_ONLY
          ? "incomplete"
          : "not-requested",
      scope:
        "Both presets: normal/default 1920x1080 four-AA 1x Save PNG within 120s; artificial-band stress must complete and reproduce exact pixels, with delivery timing reported separately",
      basis:
        "docs/surface-dielectric-study.md: Decided feasibility envelope and Selected desktop waiting targets qualify canonical export delivery; Exact tile and window invariants separately requires completion and byte identity. scripts/transmission-dielectric-gpu.mjs --tileCheck has no timing predicate. Arbitrary forced decompositions carry the failure watchdog, not an additional canonical 120s requirement.",
    },
    cancellationQualification: {
      requested: CANCEL_ONLY,
      limitMs: EXPORT_CANCEL_LIMIT_MS,
      verdict: CANCEL_ONLY ? "incomplete" : "not-requested",
      scope:
        "Both finite presets, both tiling arms: ongoing export optics, trusted Cancel to UI acknowledgement, no download, new camera frame",
    },
    memoryQualification: {
      requested: MEMORY_ONLY,
      verdict: MEMORY_ONLY ? "incomplete" : "not-measured",
      limitBytes: RETAINED_RENDER_LIMIT_BYTES,
      scope:
        "Fresh canonical 1920x1080 four-AA history. Render-phase process-tree RSS peak above repeated warmed controls plateau, and additional optical declared buffers, judged independently. No RSS+GPU summation or total physical RSS+VRAM claim.",
      exclusions:
        "256x144 pipeline warmup and one pre-baseline CDP GC; presentation/PNG encoding reported separately; driver-private/VRAM unobserved. A previously larger raster's retained allocation high-water is outside this qualification.",
    },
    scope: MEMORY_ONLY
      ? "Finite retained-render-state memory only; paired opaque/glass canonical full-HD scenes, repeated saves; throughput/identity/cancellation not qualified here"
      : CANCEL_ONLY
        ? "Finite Save-PNG cancellation only; no export throughput or pixel-identity qualification"
        : "Both finite fractal Glass presets: saved PNG identity under export tiling",
    checkingErrors: [],
    legs: [],
  };
  const launchArgs = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
  ];
  if (DISPLAY) launchArgs.push("--no-sandbox");
  else {
    launchArgs.push(
      "--headless=new",
      "--use-webgpu-adapter=swiftshader",
      "--use-vulkan=swiftshader",
    );
  }
  const launchBrowser = () =>
    chromium.launch({
      executablePath: chromium.executablePath(),
      headless: false, // + --headless=new above keeps a GPU process
      args: launchArgs,
      ...(DISPLAY ? { env: { ...process.env, DISPLAY } } : {}),
    });
  const createContext = (instance) =>
    instance.newContext({
      ignoreHTTPSErrors: true,
      viewport: DEFAULT_VIEWPORT,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      acceptDownloads: true,
    });
  let browser = null;
  try {
    finiteReport.freshDist = await guardFreshDist({ url: BASE });
    finiteReport.quietBaseline = await quietBaseline(console.error);
    const contended = contendedReason(finiteReport.quietBaseline);
    if (contended) {
      console.error(`[export-tile] UNCERTIFIED timing: ${contended}`);
    }
    browser = await launchBrowser();
    let ctx = await createContext(browser);
    check(
      runBoxfold || runTransmission || runFinite,
      `scene selector understood (${scene})`,
    );
    check(
      runFinite || (args.viewport === undefined && args.samples === undefined),
      "viewport/sample overrides apply only to an enabled finite leg",
    );
    if (runBoxfold) {
      const untiled = await runArm(ctx, "untiled", null);
      const tiled = await runArm(ctx, "tiled", MAX_RAYS);
      if (args.out !== undefined && untiled.bytes && tiled.bytes) {
        await mkdir(args.out, { recursive: true });
        await writeFile(`${args.out}/export-untiled.png`, untiled.bytes);
        await writeFile(`${args.out}/export-tiled.png`, tiled.bytes);
        console.error(
          `[export-tile] wrote ${args.out}/export-{untiled,tiled}.png`,
        );
      }
      check(untiled.tiles === 1, `untiled: one tile (saw ${untiled.tiles})`);
      check(
        tiled.tiles > 1 && tiled.tileLines === tiled.tiles,
        `tiled: ${tiled.tiles} bands, all ${tiled.tileLines} traced`,
      );
      // The live pane's fit under the same ceiling: the arm with a ceiling
      // discloses it, the arm without never fits anything.
      check(tiled.fitted, "tiled: the live pane fitted under the ceiling");
      check(!untiled.fitted, "untiled: the live pane traced its full raster");
      if (untiled.bytes && tiled.bytes) {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/?surfacegl`, { waitUntil: "load" });
        const diff = await comparePngs(page, untiled.bytes, tiled.bytes);
        await page.close();
        if (diff.other) {
          check(
            false,
            `same export size (${diff.width}x${diff.height} vs ${diff.other})`,
          );
        } else {
          console.error(
            `[export-tile] diff ${diff.width}x${diff.height}: mean ` +
              `${diff.meanDiff.toFixed(4)}/255, max ${String(diff.maxDiff)}, ` +
              `${(diff.over8 * 100).toFixed(3)}% of pixels off by >8`,
          );
          check(
            diff.meanDiff <= MEAN_DIFF_MAX,
            `mean channel diff ${diff.meanDiff.toFixed(4)} <= ${String(MEAN_DIFF_MAX)}`,
          );
          check(
            diff.over8 <= OVER8_FRACTION_MAX,
            `pixels off by >8: ${(diff.over8 * 100).toFixed(3)}% <= ` +
              `${String(OVER8_FRACTION_MAX * 100)}%`,
          );
        }
      }
    }
    // The transmission legs: the app-level export path with the transport's
    // distorted rays actually rendered (the header's TRANSMISSION LEG).
    // Byte-exact under the same bar; the premises assert the closed-solid
    // backend's lane was live at all.
    if (runTransmission) {
      for (const leg of TRANSMISSION_SCENES) {
        const untiled = await runArm(
          ctx,
          `${leg.name} untiled`,
          null,
          leg.hash,
          true,
        );
        const tiled = await runArm(
          ctx,
          `${leg.name} tiled`,
          MAX_RAYS,
          leg.hash,
          true,
        );
        if (args.out !== undefined && untiled.bytes && tiled.bytes) {
          await mkdir(args.out, { recursive: true });
          await writeFile(
            `${args.out}/export-${leg.name}-untiled.png`,
            untiled.bytes,
          );
          await writeFile(
            `${args.out}/export-${leg.name}-tiled.png`,
            tiled.bytes,
          );
        }
        check(
          untiled.tiles === 1,
          `${leg.name} untiled: one tile (saw ${untiled.tiles})`,
        );
        check(
          tiled.tiles > 1 && tiled.tileLines === tiled.tiles,
          `${leg.name} tiled: ${tiled.tiles} bands, all ${tiled.tileLines} traced`,
        );
        check(
          untiled.transportLines > 0 && tiled.transportLines > 0,
          `${leg.name}: the transport lane ran in both arms ` +
            `(${untiled.transportLines}/${tiled.transportLines} passes)`,
        );
        if (untiled.bytes && tiled.bytes) {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/?surfacegl`, { waitUntil: "load" });
          const diff = await comparePngs(page, untiled.bytes, tiled.bytes);
          await page.close();
          if (diff.other) {
            check(
              false,
              `${leg.name}: same export size (${diff.width}x${diff.height} vs ${diff.other})`,
            );
          } else {
            console.error(
              `[export-tile] ${leg.name} diff ${diff.width}x${diff.height}: mean ` +
                `${diff.meanDiff.toFixed(4)}/255, max ${String(diff.maxDiff)}, ` +
                `${(diff.over8 * 100).toFixed(3)}% of pixels off by >8`,
            );
            check(
              diff.meanDiff <= MEAN_DIFF_MAX,
              `${leg.name}: mean channel diff ${diff.meanDiff.toFixed(4)} <= ${String(MEAN_DIFF_MAX)}`,
            );
            check(
              diff.over8 <= OVER8_FRACTION_MAX,
              `${leg.name}: pixels off by >8: ${(diff.over8 * 100).toFixed(3)}% <= ` +
                `${String(OVER8_FRACTION_MAX * 100)}%`,
            );
          }
        }
      }
    }
    if (runFinite) {
      await mkdir(FINITE_OUT, { recursive: true });
      for (const [preset, dimension] of [
        ["glassMenger", 3],
        ["glassMenger4", 4],
      ]) {
        const leg = { preset, dimension, arms: {} };
        finiteReport.legs.push(leg);
        try {
          const authored = await authorFiniteDocument(ctx, preset, dimension);
          leg.authored = authored;
          leg.documentSha256 = sha256(JSON.stringify(authored.document));
          await writeFile(
            `${FINITE_OUT}/${preset}-document.json`,
            `${JSON.stringify(authored, null, 2)}\n`,
          );
          if (MEMORY_ONLY) {
            const opaqueDocument = structuredClone(authored.document);
            for (const transform of opaqueDocument.transforms)
              delete transform.optics;
            const opaque = {
              ...authored,
              document: opaqueDocument,
              hash: `#v1=${Buffer.from(JSON.stringify(opaqueDocument)).toString("base64url")}`,
            };
            leg.geometrySha256 = sha256(JSON.stringify(opaqueDocument));
            leg.memoryVariants = {
              scope:
                "Exactly the app-authored canonical document; opaque baseline removes only each transform's optics field",
              opaqueHash: opaque.hash,
              glassHash: authored.hash,
            };
            for (const [arm, optics, input] of [
              ["opaque", false, opaque],
              ["glass", true, authored],
            ]) {
              const evidence = { complete: false };
              leg.arms[arm] = evidence;
              try {
                // A new browser tree prevents a preceding full-HD arm's
                // allocator arenas from becoming the next controls baseline.
                await browser.close();
                evidence.quietBaseline = await quietBaseline(console.error);
                browser = await launchBrowser();
                ctx = await createContext(browser);
                evidence.freshBrowserProcess = true;
                await runFiniteMemoryArm(
                  ctx,
                  `${preset} ${arm}`,
                  input,
                  optics,
                  evidence,
                );
              } catch (error) {
                evidence.error = error.stack ?? error.message;
                check(false, `${preset} ${arm} memory: ${error.message}`);
              }
            }
            const opaqueRss =
              leg.arms.opaque.rss?.retainedRenderAboveControlsBytes;
            const glassRss =
              leg.arms.glass.rss?.retainedRenderAboveControlsBytes;
            const opticalBytes =
              leg.arms.glass.opticalAccounting?.expectedBytes;
            const pairedDeclaredGpu = pairedDeclaredGpuBuffers(
              leg.arms.opaque,
              leg.arms.glass,
            );
            leg.memoryComparison = {
              opaqueRenderAboveControlsBytes: opaqueRss ?? null,
              glassRenderAboveControlsBytes: glassRss ?? null,
              pairedOpticsRssDifferenceBytes:
                opaqueRss != null && glassRss != null
                  ? glassRss - opaqueRss
                  : null,
              independentOpticalDeclaredBytes: opticalBytes ?? null,
              pairedDeclaredGpu,
              pairedDeclaredGpuScope:
                "All live GPU buffers at matching live/repeat1/repeat2 phases. Shared buffers must match by size/usage except the independently identified 224-to-256-byte shade uniform; every other added byte must belong to the optical census.",
              limitBytes: RETAINED_RENDER_LIMIT_BYTES,
              combiningObservables: false,
            };
            check(
              glassRss != null && glassRss <= RETAINED_RENDER_LIMIT_BYTES,
              `${preset}: measured glass retained render RSS above warmed controls ${glassRss ?? "unqualified"} <= ${RETAINED_RENDER_LIMIT_BYTES} bytes`,
            );
            check(
              opticalBytes != null &&
                opticalBytes <= RETAINED_RENDER_LIMIT_BYTES,
              `${preset}: independently counted optical declared buffers ${opticalBytes ?? "unqualified"} <= ${RETAINED_RENDER_LIMIT_BYTES} bytes`,
            );
            for (const paired of pairedDeclaredGpu)
              check(
                paired.errors.length === 0,
                `${preset} ${paired.phase}: total glass-minus-opaque declared GPU buffers ${paired.totalDeltaBytes ?? "missing"} <= ${RETAINED_RENDER_LIMIT_BYTES} bytes, no unattributed allocations (${paired.errors.join("; ") || "exact optical buffers plus 32-byte uniform tail"})`,
              );
            continue;
          }
          const images = {};
          for (const [arm, maxRays] of [
            ["untiled", null],
            ["tiled", MAX_RAYS],
          ]) {
            const evidence = {};
            leg.arms[arm] = evidence;
            let result;
            try {
              result = await runArm(
                ctx,
                `${preset} ${arm}`,
                maxRays,
                authored.hash,
                true,
                { ...authored, evidence },
              );
            } catch (error) {
              evidence.error = error.stack ?? error.message;
              check(false, `${preset} ${arm}: ${error.message}`);
              continue;
            }
            const { bytes, ...details } = result;
            Object.assign(evidence, details);
            if (CANCEL_ONLY) {
              check(
                result.fitted === (arm === "tiled"),
                `${preset} ${arm}: cancellation arm used expected live raster ceiling`,
              );
              continue;
            }
            if (bytes) {
              images[arm] = bytes;
              evidence.pngSha256 = sha256(bytes);
              evidence.png = `export-${preset}-${arm}.png`;
              await writeFile(`${FINITE_OUT}/${evidence.png}`, bytes);
            }
            check(
              arm === "untiled"
                ? result.tiles === 1 && result.tileLines === 1 && !result.fitted
                : result.tiles > 1 &&
                    result.tileLines === result.tiles &&
                    result.fitted,
              `${preset} ${arm}: actual ${result.tiles}-band export and expected live raster`,
            );
          }
          if (CANCEL_ONLY) continue;
          if (images.untiled && images.tiled) {
            const page = await ctx.newPage();
            try {
              const diff = await comparePngs(
                page,
                images.untiled,
                images.tiled,
              );
              leg.diff = diff;
              check(
                !diff.other &&
                  diff.meanDiff === 0 &&
                  diff.maxDiff === 0 &&
                  diff.alphaDifferences === 0,
                `${preset}: saved tiled/untiled PNG pixels are byte-identical (${JSON.stringify(diff)})`,
              );
              for (const [arm, evidence] of Object.entries(leg.arms)) {
                check(
                  evidence.bands.every((band) => band.width === diff.width) &&
                    evidence.bands.reduce(
                      (sum, band) => sum + band.height,
                      0,
                    ) === diff.height,
                  `${preset} ${arm}: completed bands cover the entire downloaded PNG`,
                );
              }
            } finally {
              await page.close();
            }
          } else {
            check(false, `${preset}: both Save-PNG arms produced images`);
          }
        } catch (error) {
          leg.error = error.message;
          check(false, `${preset}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    finiteReport.checkingErrors.push(error.stack ?? error.message);
    check(false, `checking failure: ${error.message}`);
  } finally {
    try {
      await browser?.close();
    } catch (error) {
      finiteReport.checkingErrors.push(`browser cleanup: ${error.message}`);
      check(false, `browser cleanup: ${error.message}`);
    }
    if (runFinite) {
      finiteReport.completed =
        finiteReport.legs.length === 2 &&
        ["glassMenger", "glassMenger4"].every((preset) =>
          finiteReport.legs.some(
            (leg) =>
              leg.preset === preset &&
              leg.authored &&
              (MEMORY_ONLY ? leg.memoryComparison : CANCEL_ONLY || leg.diff) &&
              !leg.error &&
              (MEMORY_ONLY ? ["opaque", "glass"] : ["untiled", "tiled"]).every(
                (arm) =>
                  (MEMORY_ONLY
                    ? leg.arms[arm]?.complete
                    : CANCEL_ONLY
                      ? leg.arms[arm]?.cancellation?.complete
                      : leg.arms[arm]?.png &&
                        leg.arms[arm].bands?.length > 0 &&
                        leg.arms[arm].exportTiming?.complete) &&
                  !leg.arms[arm].error,
              ),
          ),
        );
      check(
        finiteReport.completed,
        `both finite presets completed both ${MEMORY_ONLY ? "memory" : CANCEL_ONLY ? "cancellation" : "export"} arms`,
      );
      finiteReport.timingCertified = Boolean(
        DISPLAY &&
        finiteReport.completed &&
        finiteReport.freshDist?.checked &&
        finiteReport.quietBaseline?.contended === false &&
        finiteReport.legs.every((leg) =>
          Object.values(leg.arms).every(
            (arm) =>
              namedHardware(arm.settledState?.backend) &&
              (!MEMORY_ONLY || arm.quietBaseline?.contended === false),
          ),
        ),
      );
      if (QUALIFY_FULL_HD || CANCEL_ONLY) {
        check(
          finiteReport.timingCertified,
          `${MEMORY_ONLY ? "Memory" : CANCEL_ONLY ? "Cancellation" : "Full HD 4-AA"} run is certified: fresh build, quiet baseline, named hardware in every arm`,
        );
        const qualification = MEMORY_ONLY
          ? finiteReport.memoryQualification
          : CANCEL_ONLY
            ? finiteReport.cancellationQualification
            : finiteReport.fullHdQualification;
        qualification.verdict = failures.length === 0 ? "pass" : "fail";
        if (
          MEMORY_ONLY &&
          finiteReport.legs.some((leg) =>
            Object.values(leg.arms).some((arm) => arm.rss?.status !== "ok"),
          )
        )
          qualification.verdict = "unqualified";
      }
      finiteReport.finishedAt = new Date().toISOString();
      finiteReport.failures = [...failures];
      finiteReport.verdict = finiteReport.checkingErrors.length
        ? "checking-failed"
        : failures.length === 0
          ? "pass"
          : "fail";
      await mkdir(FINITE_OUT, { recursive: true });
      await writeFile(
        `${FINITE_OUT}/${FINITE_REPORT_FILE}`,
        `${JSON.stringify(finiteReport, null, 2)}\n`,
      );
      console.error(
        `[export-tile] report: ${FINITE_OUT}/${FINITE_REPORT_FILE}`,
      );
    }
  }
  console.error(
    failures.length === 0
      ? "[export-tile] PASS"
      : `[export-tile] FAIL (${String(failures.length)}): ${failures.join("; ")}`,
  );
  process.exit(
    finiteReport.checkingErrors.length ? 2 : failures.length === 0 ? 0 : 1,
  );
}

await main();
