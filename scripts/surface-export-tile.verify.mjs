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
 * Usage: node scripts/surface-export-tile.verify.mjs [--url=...]
 *          [--display=:0] [--maxrays=60000] [--out=/tmp]
 *          [--scene=boxfold|transmission|all]
 * (url defaults to https://localhost:4173 — `npm run build && npm run
 * preview` first. --display runs headed against a real X display / real
 * driver instead of headless SwiftShader; --out keeps both exports as
 * PNGs to eyeball, which is how a failing diff gets read.)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { chromium } from "playwright-core";
import { guardFreshDist } from "./lib/dist-freshness.mjs";

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

/** One arm: load the pinned scene, enter Surface, settle, Save PNG.
 * Resolves the PNG bytes plus what the run disclosed about itself. */
async function runArm(
  ctx,
  label,
  maxRays,
  scene = SCENE,
  watchTransport = false,
) {
  const page = await ctx.newPage();
  const tiles = [];
  let computeActive = false;
  let fitted = false;
  let transportLines = 0;
  page.on("console", (m) => {
    const t = m.text();
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

  await openPanelSection(page, "captureSection");
  const dl = page.waitForEvent("download", { timeout: EXPORT_TIMEOUT_MS });
  const c0 = Date.now();
  await page.click("#savePngBtn");
  let bytes = null;
  try {
    const download = await dl;
    const file = await download.path();
    bytes = await readFile(file);
  } catch (err) {
    check(false, `${label}: Save PNG produced a download (${err.message})`);
  }
  check(
    bytes !== null,
    `${label}: exported (${((Date.now() - c0) / 1000).toFixed(1)}s, ` +
      `${bytes === null ? "no file" : `${(bytes.length / 1024).toFixed(0)}KB`})`,
  );
  await page.close();
  return {
    bytes,
    fitted,
    tiles: tiles.length === 0 ? 0 : tiles[0],
    tileLines: tiles.length,
    transportLines,
  };
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
      }
      return {
        width: x.width,
        height: x.height,
        meanDiff: sum / (px * 3),
        maxDiff: max,
        over8: over8 / px,
      };
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

async function main() {
  await guardFreshDist({ url: BASE });
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
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false, // + --headless=new above: the combination that keeps a GPU process
    args: launchArgs,
    ...(DISPLAY ? { env: { ...process.env, DISPLAY } } : {}),
  });
  try {
    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 900, height: 560 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      acceptDownloads: true,
    });
    const scene = args.scene ?? "boxfold";
    const runBoxfold = scene === "boxfold" || scene === "all";
    const runTransmission = scene === "transmission" || scene === "all";
    check(
      runBoxfold || runTransmission,
      `scene selector understood (${scene})`,
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
  } finally {
    await browser.close();
  }
  console.error(
    failures.length === 0
      ? "[export-tile] PASS"
      : `[export-tile] FAIL (${String(failures.length)}): ${failures.join("; ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

await main();
