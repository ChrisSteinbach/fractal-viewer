#!/usr/bin/env node
/**
 * Browser verification that entering Surface render mode in a browser
 * WITHOUT usable WebGPU (Firefox/Linux-shaped: `navigator.gpu` is
 * undefined) paints a traced frame WITHOUT any camera/pointer nudge.
 *
 * THE BUG. `SurfaceComputeRenderer.supported()` is false whenever
 * `navigator.gpu` is missing, so every surface session takes the WebGL
 * GLSL arm. That arm gates its first frame on an async shader compile
 * (`scene.compileSurfaceMaterial()`); when it resolves, main.ts fires one
 * `scene.invalidate()`. Pre-fix, that one-shot invalidation could be
 * consumed by some OTHER draw before the render-tier clock's own frame
 * read noticed it, and on this fallback path the camera-entry glide has
 * already spent itself (no further motion to invalidate on its own
 * behalf) — so the canvas could sit on the frozen live-explorer frame
 * until the user dragged the view. THE FIX (src/app/main.ts): a
 * `surfaceWebglPreviewPending` flag set the instant the compile gate
 * resolves, OR'd into `tickRender`'s tier read
 * (`surfaceRenderTier.frame(now, scene.needsRender || surfaceWebglPreviewPending)`)
 * and cleared only once a preview actually traces — un-losable by
 * construction.
 *
 * THE HARNESS. Launched under SwiftShader (the webgl-smoke/surface-tier
 * recipe) with WebGPU switched off via `--disable-features=WebGPU` PLUS an
 * init script that stubs `navigator.gpu` itself to `undefined` on every
 * navigation: empirically, this Chromium build's `--disable-features=WebGPU`
 * alone leaves `navigator.gpu` present as an (unusable) object — only an
 * async `requestAdapter()` round-trip discovers that, which is a different
 * code path than the synchronous Firefox-shaped one
 * (`SurfaceComputeRenderer.supported()` reads `!!navigator.gpu` directly,
 * with no await). The init script makes the property itself read exactly
 * like Firefox from the first synchronous check, asserted below on every
 * case. So every case here is forced onto the WebGL arm the fix lives on,
 * exactly the Firefox/Linux code path. Three cases, in order:
 *
 *   a. default scene — the plain-affine WebGL arm.
 *   b. an escape-eligible scene: one flat map, variations
 *      `[{type:"mandelbox", weight:2}]`, scale 1 -> lip =
 *      |w|*SPHEREFOLD_LIPSCHITZ*sigma_max = 2*4*1 = 8, comfortably past
 *      CONTRACTION_LIMIT (0.999) -> analyzeSurfaceSystem refuses (no IFS
 *      attractor), analyzeEscapeSystem accepts (the canonical Mandelbox
 *      escape-time set) -- the user's original repro class. No built-in
 *      preset qualifies (checked against every entry in
 *      src/fractal/presets.ts), so this is loaded via a minted `#v1=`
 *      hash.
 *   c. a fold IFS class: src/fractal/presets.ts's `mandelboxKifs()`
 *      ("Mandelbox KIFS") — twelve maps, each exactly one fold-family
 *      variation, contracting -> analyzeSurfaceSystem eligible with
 *      `deHasFolds` true, i.e. the fold-descent GLSL variant, which links
 *      slowly (module docs cite ~25s on desktop Mesa). Also loaded via a
 *      minted hash rather than the `#presetSelect` UI control: that
 *      preset carries a `PRESET_RENDER_HINTS` "surface" hint that
 *      auto-enters Surface as soon as its cloud lands (main.ts's
 *      `pendingRenderMode`), which would race this script's own
 *      "screenshot before entry, click, then poll with zero input"
 *      protocol — a `#v1=` document load always boots into the
 *      point-cloud explorer regardless of content (persist.ts), so a
 *      hash sidesteps the hint entirely and every case below enters
 *      Surface through the exact same single action: clicking
 *      `#modeSurfaceBtn`.
 *
 *   d. (the 4D cut) a 4D scene: three contracting affine maps, one
 *      carrying a live `w` block (`w: {position, rotation: {xw}}`), flat
 *      kaleidoscope — `systemPartsAreNonFlat` true, `analyzeSurfaceSystem4`
 *      eligible (verified at mint time like b/c). Since the 4D cut,
 *      a 4D surface session PREFERS the WebGPU compute renderer (the
 *      affine4 kernel core) and the fragment 4D tracer
 *      (`surface-material-4d.ts`) is now the FALLBACK arm — exactly like
 *      the fold/escape 3D kinds already were — so with WebGPU disabled
 *      this case exercises that same fallback arm, one dimension up, and
 *      the compile-gate fix (shared code — `compileSurfaceMaterial`
 *      is reached from every WebGL-arm branch, 3D and 4D alike). ALSO
 *      carries the render-backend disclosure token: `render-backend.ts`'s
 *      `surfaceWebglDetail` treats any 4D system as `computeShaped`, so a
 *      WebGL 4D fallback session's progress row should trail
 *      `" — compute unavailable"` — checked and reported verbatim, not just
 *      asserted, since a fast settle can outrun the poll before the row is
 *      ever caught visible.
 *
 * Both 3D hashes were minted by a throwaway `npx tsx` script that called the
 * app's own `initialState`/`toSnapshot`/`encodeScene`
 * (src/app/state.ts, src/app/persist.ts) and round-tripped the result
 * through `decodeScene` before printing it — so each is exactly what the
 * app's own encoder produces and exactly what its own strict decoder
 * accepts (the throwaway script lived in /tmp deliberately, and is not part
 * of this repo). Case d's hash was minted the same way, with the additional
 * pre/post-decode check that `systemPartsAreNonFlat` and
 * `analyzeSurfaceSystem4` both agree the DECODED document (not just the
 * authored one) gates the same way.
 *
 * THE CORE ASSERTION, per case: screenshot the CANVAS ELEMENT ONLY (not
 * the full viewport — the control panel opens by default at this
 * viewport width (800 > constants.ts's MOBILE_BREAKPOINT of 640) and its
 * accordion reflows on every render-mode switch, which would contaminate
 * a full-page diff with UI chrome changes that have nothing to do with
 * whether a frame traced) before entering Surface, click
 * `#modeSurfaceBtn`, then — with ZERO further pointer/keyboard/camera
 * input — poll canvas screenshots against that baseline until a material
 * difference appears (>2% of PNG bytes differ) or a ~3 minute budget
 * expires. `#surfaceProgress` is read every poll and its (visible, text)
 * pair recorded on every change — the element idles HIDDEN whenever the
 * session is settled or has no in-flight strip job, which means DONE, not
 * "never started"; this script never mistakes hidden for stalled. Case d
 * additionally scans EVERY recorded sample (visible or not — `ui.ts`'s
 * `setSurfaceProgress(null)` never clears stale textContent, only the
 * `hidden` class) for the "compute unavailable" token, asserting it only
 * when the row was actually caught visible at least once.
 *
 * Usage: node scripts/surface-fallback.verify.mjs [url] [caseFilter]
 * (url defaults to https://localhost:5173 — start a dev server first.
 * caseFilter is a substring match over "abcd", default "all".)
 * Screenshots land in .playwright-mcp/ (gitignored) for eyeballing.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", ".playwright-mcp");
const BASE = (process.argv[2] ?? "https://localhost:5173").replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Minted scenes (see the module doc above for provenance + eligibility math).
// ---------------------------------------------------------------------------

/** Case B: one flat map, pure `mandelbox` fold at weight 2, scale 1 ->
 * non-contracting -> analyzeSurfaceSystem refuses, analyzeEscapeSystem
 * accepts (verified against both gate functions at mint time). */
const ESCAPE_HASH =
  "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoyfV19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjEsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjF9";

/** Case C: presets.ts's `mandelboxKifs()` verbatim — twelve maps, each one
 * fold-family variation, contracting -> analyzeSurfaceSystem eligible,
 * `deHasFolds` true (verified at mint time). */
const FOLD_HASH =
  "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNywwLjcsMC43XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC4xOSwwLjE5LDAuMTldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoxLjJ9XX0seyJwb3NpdGlvbiI6WzAuNywwLjcsLTAuN10sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuMTksMC4xOSwwLjE5XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6Im1hbmRlbGJveCIsIndlaWdodCI6MS4yfV19LHsicG9zaXRpb24iOlswLjcsLTAuNywwLjddLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjE5LDAuMTksMC4xOV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJtYW5kZWxib3giLCJ3ZWlnaHQiOjEuMn1dfSx7InBvc2l0aW9uIjpbMC43LC0wLjcsLTAuN10sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuMTksMC4xOSwwLjE5XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6Im1hbmRlbGJveCIsIndlaWdodCI6MS4yfV19LHsicG9zaXRpb24iOlstMC43LDAuNywwLjddLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjE5LDAuMTksMC4xOV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJtYW5kZWxib3giLCJ3ZWlnaHQiOjEuMn1dfSx7InBvc2l0aW9uIjpbLTAuNywwLjcsLTAuN10sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuMTksMC4xOSwwLjE5XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6Im1hbmRlbGJveCIsIndlaWdodCI6MS4yfV19LHsicG9zaXRpb24iOlstMC43LC0wLjcsMC43XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC4xOSwwLjE5LDAuMTldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoxLjJ9XX0seyJwb3NpdGlvbiI6Wy0wLjcsLTAuNywtMC43XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC4xOSwwLjE5LDAuMTldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoxLjJ9XX0seyJwb3NpdGlvbiI6WzAuNjIsMC42MiwwLjYyXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC42NiwwLjY2LDAuNjZdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MX1dfSx7InBvc2l0aW9uIjpbMC42MiwtMC42MiwtMC42Ml0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNjYsMC42NiwwLjY2XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6ImJveGZvbGQiLCJ3ZWlnaHQiOjF9XX0seyJwb3NpdGlvbiI6Wy0wLjYyLDAuNjIsLTAuNjJdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjY2LDAuNjYsMC42Nl0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxfV19LHsicG9zaXRpb24iOlstMC42MiwtMC42MiwwLjYyXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC42NiwwLjY2LDAuNjZdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MX1dfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxfQ";

/** Case D (the 4D cut): three contracting affine maps (one carrying a live
 * `w` block: position 0.5, an xw rotation of 0.3), flat kaleidoscope
 * (order 1) -> systemPartsAreNonFlat true, analyzeSurfaceSystem4 eligible
 * (verified at mint time, including a POST-decode re-check with the same
 * gate functions). Routes to the 4D fragment tracer fallback arm when
 * WebGPU is unavailable (the 4D cut's new preferred engine is the
 * WebGPU compute affine4 kernel; this hash exercises its fallback). */
const PLAIN4_HASH =
  "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNSwwLDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInciOnsicG9zaXRpb24iOjAuNSwicm90YXRpb24iOnsieHciOjAuM319fSx7InBvc2l0aW9uIjpbLTAuMjUsMC40MywwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMjUsLTAuNDMsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MX0";

/** Case e: the fold-4D scene — a pure-boxfold 4D pair, the CPU/GPU fold
 * fixtures' shape, order 1. Fold-shaped 4D systems are COMPUTE-ONLY (no
 * fold GLSL exists in the fragment 4D tracer), so with navigator.gpu
 * stubbed away the expected behavior is the REFUSAL: the Surface control
 * disabled with the WebGPU reason — never a fold-blind render. */
const FOLD4_HASH =
  "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6ImJveGZvbGQiLCJ3ZWlnaHQiOjF9XSwidyI6eyJwb3NpdGlvbiI6MC4zLCJyb3RhdGlvbiI6eyJ4dyI6MC4zfX19LHsicG9zaXRpb24iOlstMC40LC0wLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6ImJveGZvbGQiLCJ3ZWlnaHQiOjF9XSwidyI6eyJwb3NpdGlvbiI6LTAuMywicm90YXRpb24iOnsieXciOjAuMjV9fX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MX0";

/** Upper bound for the WebGL compile gate + first traced preview to land,
 * per case. The fold-descent GLSL variant (case c) links in ~25s on
 * desktop Mesa per surface-material.ts's module docs; SwiftShader is
 * comparable-to-slower, so this is generous but not unbounded — a case
 * blowing this budget is reported as a FAIL with whatever evidence was
 * gathered, and no heavier case is attempted afterward. */
const CASE_BUDGET_MS = 3 * 60_000;

/** Poll cadence while watching for the canvas to paint. */
const POLL_MS = 1_500;

/** Two screenshots of the SAME canvas count as materially different once
 * more than this fraction of PNG bytes differ (the specified threshold —
 * coarse but robust: the discriminating cases are "still the frozen
 * point-cloud explorer frame" vs "now a traced sphere," not a subtle
 * pixel-level difference). */
const PAINT_DIFF_PCT = 2;

const failures = [];
function check(ok, label) {
  console.error(`[surface-fallback] ${ok ? "ok " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
}

/** Percentage of PNG bytes that differ between two same-source screenshot
 * buffers. Length differences (a genuinely different image compresses to a
 * different size) count in full toward the differing total. */
function pngDiffPct(a, b) {
  const len = Math.max(a.length, b.length);
  if (len === 0) return 0;
  let diff = Math.abs(a.length - b.length);
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return (diff / len) * 100;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const env = { ...process.env };
  delete env.DISPLAY; // offscreen SwiftShader, not X11 GLX (see webgl-smoke.mjs)
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false, // + --headless=new below — the combination that yields WebGL
    env,
    args: [
      "--headless=new",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--no-sandbox",
      // The Firefox/Linux-shaped code path under test: navigator.gpu
      // becomes undefined, so SurfaceComputeRenderer.supported() is false
      // and every surface session below is forced onto the WebGL GLSL
      // arm — the one the fix lives on.
      "--disable-features=WebGPU",
    ],
  });
  const pageErrors = [];
  const consoleMessages = [];
  let page = null;
  const caseResults = [];
  try {
    page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 800, height: 600 },
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
      console.error(`[page:${msg.type()}] ${msg.text()}`);
    });
    page.setDefaultTimeout(CASE_BUDGET_MS + 30_000);
    // Empirically, this Chromium build's --disable-features=WebGPU (kept
    // in the launch args above as a first line of defense) still leaves
    // `navigator.gpu` present as an object -- only requestAdapter()
    // resolving null signals unavailability, an async round-trip that
    // takes a DIFFERENT code path than the synchronous Firefox-shaped one
    // (SurfaceComputeRenderer.supported() reads `!!navigator.gpu`
    // directly). Stub the property itself so it reads exactly like
    // Firefox from the first synchronous check, on every navigation this
    // page makes (addInitScript persists across page.goto calls).
    await page.addInitScript(() => {
      try {
        Object.defineProperty(window.navigator, "gpu", {
          get: () => undefined,
          configurable: true,
        });
      } catch {
        // Best effort -- the per-case navigator.gpu assertion below is
        // the actual guard, not this try/catch.
      }
    });
    // Reduced motion: REQUIRED under SwiftShader (see surface-tier.verify.mjs)
    // — without it a camera tween keeps invalidating for minutes and the
    // tier scheduler never leaves preview, so the settle under test never
    // fires. It also matches the bug's own shape: the camera is PARKED (no
    // glide in flight) at the moment the compile gate resolves, exactly
    // the condition 2ca508b's race needed to strand the session.
    await page.emulateMedia({ reducedMotion: "reduce" });

    // CRITICAL: page.goto() between two URLs differing ONLY in the hash
    // fragment (same origin+path+query) is a SAME-DOCUMENT navigation —
    // the browser does not reload, so the app's JS context (and whatever
    // scene was already loaded) survives untouched. The app has no
    // `hashchange` listener (loadScene() only runs once at boot), so a
    // later case's page.goto(differentHashSameOrigin) silently strands
    // the session on an EARLIER case's scene while location.hash in the
    // address bar still updates — confirmed empirically with a throwaway
    // diagnostic (a window marker set after the first load survives a
    // second goto to a different-hash, same-query URL). Found via a
    // downstream script's bug (see surface-4d.verify.mjs's gotoFresh):
    // this script's own case a (bare "/") -> b/c/d (hash-only) chain has
    // the EXACT same shape and was equally exposed — cases b/c/d in every
    // "all"-mode run before this fix never actually loaded their intended
    // scenes; only case a was ever a genuine load. Bouncing through
    // about:blank forces a real navigation every time.
    async function gotoFresh(url, opts) {
      await page.goto("about:blank");
      await page.goto(url, opts);
    }

    /** Canvas-only screenshot — NOT the full viewport. The control panel
     * opens by default at this width (800 > MOBILE_BREAKPOINT's 640) and
     * its accordion reflows on every render-mode switch (different
     * control rows shown per mode), which would contaminate a full-page
     * diff with UI chrome changes unrelated to whether a frame traced. */
    const canvasShot = (name) =>
      page
        .locator("canvas")
        .first()
        .screenshot({
          type: "png",
          ...(name ? { path: path.join(OUT_DIR, name) } : {}),
        });

    /** #surfaceProgress idles HIDDEN (class "hidden") whenever the surface
     * session is settled or has no in-flight strip job — that means DONE,
     * not "nothing has started yet". Callers must not mistake hidden for
     * stalled. */
    const readSurfaceProgress = () =>
      page.evaluate(() => {
        const el = document.getElementById("surfaceProgress");
        if (!el) return { visible: false, text: null };
        return {
          visible: !el.classList.contains("hidden"),
          text: el.textContent,
        };
      });

    const armContextLossTripwire = () =>
      page.evaluate(() => {
        window.__glLost = false;
        document
          .querySelector("canvas")
          ?.addEventListener("webglcontextlost", () => {
            window.__glLost = true;
          });
      });

    const waitForPointCount = () =>
      page.waitForFunction(
        () => {
          const el = document.getElementById("pointCount");
          return (
            !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0
          );
        },
        undefined,
        { timeout: 30_000, polling: 100 },
      );

    /**
     * Runs the shared core assertion for one case: navigate to
     * `${BASE}/${hashPath}` (a fresh boot every time — hash documents
     * always land in the point-cloud explorer regardless of content, per
     * persist.ts, so this never races a preset's auto-enter hint), read
     * eligibility + navigator.gpu, screenshot the pre-Surface canvas,
     * click #modeSurfaceBtn as the ONE entry action, then — with ZERO
     * further input — poll canvas screenshots against that baseline until
     * a material difference appears or the budget expires.
     */
    async function runCase(label, hashPath, screenshotPrefix, opts = {}) {
      const { expect4DDetailToken = false, pollMs = POLL_MS } = opts;
      console.error(
        `[surface-fallback] ==== case ${label}: ${hashPath || "(default)"} ====`,
      );
      const result = {
        label,
        entered: false,
        painted: false,
        elapsedMs: null,
        finalDiffPct: null,
        progressObservations: [],
        gpuUndefined: null,
        controlEnabled: null,
        contextLost: null,
        newPageErrors: [],
        sawComputeActive: false,
        sawComputeUnavailableToken: null,
        before: null,
        after: null,
      };
      const pageErrorsBefore = pageErrors.length;
      const consoleBefore = consoleMessages.length;

      await gotoFresh(`${BASE}/${hashPath}`, {
        waitUntil: "load",
        timeout: 30_000,
      });
      await waitForPointCount();
      await armContextLossTripwire();

      const gpuStatus = await page.evaluate(() => ({
        hasNavigatorGpu: "gpu" in navigator,
        gpuIsUndefined: navigator.gpu === undefined,
      }));
      result.gpuUndefined = gpuStatus.gpuIsUndefined;
      check(
        gpuStatus.gpuIsUndefined,
        `${label}: navigator.gpu is undefined (${JSON.stringify(gpuStatus)})`,
      );

      // Let the boot/load camera glide land completely (reduced motion
      // snaps it, but the regen itself takes a moment) before reading
      // eligibility or taking the "before" screenshot — a still-settling
      // view here would confound the "zero input from here on" protocol
      // that starts at the Surface click below.
      await page.waitForTimeout(1_000);

      const disabled = await page.$eval("#modeSurfaceBtn", (b) => b.disabled);
      result.controlEnabled = !disabled;
      check(!disabled, `${label}: Surface mode control is enabled`);
      if (disabled) {
        check(
          false,
          `${label}: aborted — scene did not gate as surface-eligible`,
        );
        caseResults.push(result);
        return result;
      }

      const before = await canvasShot(`${screenshotPrefix}-1-before.png`);
      result.before = `${screenshotPrefix}-1-before.png`;

      const t0 = Date.now();
      await page.click("#modeSurfaceBtn");
      result.entered = true;

      // ---- Poll with ZERO further input: no pointer/keyboard/camera -------
      const deadline = t0 + CASE_BUDGET_MS;
      let lastDiff = 0;
      for (;;) {
        const progress = await readSurfaceProgress();
        const lastObs = result.progressObservations.at(-1);
        if (
          !lastObs ||
          lastObs.visible !== progress.visible ||
          lastObs.text !== progress.text
        ) {
          const atMs = Date.now() - t0;
          result.progressObservations.push({ ...progress, atMs });
          console.error(
            `[surface-fallback] ${label} progress @${atMs}ms: visible=${progress.visible} text=${JSON.stringify(progress.text)}`,
          );
        }
        const cur = await canvasShot(null);
        lastDiff = pngDiffPct(before, cur);
        if (lastDiff > PAINT_DIFF_PCT || Date.now() > deadline) break;
        await page.waitForTimeout(pollMs);
      }
      result.elapsedMs = Date.now() - t0;
      result.finalDiffPct = lastDiff;
      result.painted = lastDiff > PAINT_DIFF_PCT;
      await canvasShot(`${screenshotPrefix}-2-after.png`);
      result.after = `${screenshotPrefix}-2-after.png`;

      check(
        result.painted,
        `${label}: canvas painted a traced frame with no input (diff ${lastDiff.toFixed(1)}%, ${result.elapsedMs}ms since Surface-entry click)`,
      );

      result.contextLost = await page.evaluate(() => window.__glLost === true);
      check(!result.contextLost, `${label}: WebGL context survived`);

      result.newPageErrors = pageErrors.slice(pageErrorsBefore);
      check(
        result.newPageErrors.length === 0,
        `${label}: no page errors (${result.newPageErrors.join("|")})`,
      );

      const newConsole = consoleMessages.slice(consoleBefore);
      result.sawComputeActive = newConsole.some((m) =>
        m.text.includes("WebGPU compute tracer active"),
      );
      check(
        !result.sawComputeActive,
        `${label}: console never claimed the WebGPU compute tracer (WebGPU is disabled)`,
      );
      // Soft invariant: whenever the progress row showed text, it must
      // name the WebGL engine, never WebGPU (WebGPU is force-disabled
      // process-wide) — only checked when something was actually
      // observed, since a very fast compile can settle between polls
      // without ever being caught mid-flight.
      const shownTexts = result.progressObservations.filter(
        (o) => o.visible && o.text,
      );
      if (shownTexts.length > 0) {
        check(
          shownTexts.every((o) => o.text.includes("WebGL")),
          `${label}: every observed progress label names WebGL (${shownTexts.map((o) => o.text).join(" | ")})`,
        );
      } else {
        console.error(
          `[surface-fallback] ${label}: #surfaceProgress never observed visible (compile+trace likely faster than the poll cadence)`,
        );
      }

      // The render-backend disclosure's 4D token (the 4D cut widened
      // surfaceWebglDetail's computeShaped test to every 4D system): a 4D
      // WebGL-fallback session's progress row should trail
      // " — compute unavailable". Scan EVERY recorded sample, visible or
      // not — ui.ts's setSurfaceProgress(null) only toggles the "hidden"
      // class, it never clears stale textContent — but only ASSERT the
      // token when the row was actually caught visible at least once; a
      // settle that outran the poll cadence is reported, not failed.
      if (expect4DDetailToken) {
        const anySampleWithToken = result.progressObservations.filter(
          (o) => o.text && o.text.includes("compute unavailable"),
        );
        console.error(
          `[surface-fallback] ${label}: samples (visible or not) containing "compute unavailable": ${
            anySampleWithToken.length
              ? anySampleWithToken
                  .map(
                    (o) =>
                      `@${o.atMs}ms visible=${o.visible} ${JSON.stringify(o.text)}`,
                  )
                  .join(" | ")
              : "none"
          }`,
        );
        if (shownTexts.length > 0) {
          const sawTokenWhileVisible = shownTexts.some((o) =>
            o.text.includes("compute unavailable"),
          );
          result.sawComputeUnavailableToken = sawTokenWhileVisible;
          check(
            sawTokenWhileVisible,
            `${label}: visible progress row discloses "compute unavailable" (${shownTexts.map((o) => o.text).join(" | ")})`,
          );
        } else {
          result.sawComputeUnavailableToken = false;
          console.error(
            `[surface-fallback] ${label}: #surfaceProgress never observed visible -- cannot confirm the "compute unavailable" disclosure token (settled faster than the poll cadence); not asserted.`,
          );
        }
      }

      caseResults.push(result);
      return result;
    }

    // Optional third CLI arg selects a subset of cases (substring match on
    // "a"/"b"/"c", e.g. "b" or "bc"); default "all" runs every case in
    // order with the normal budget-descent gating. Exists for the
    // blank-until-nudge baseline A/B (main.ts pre-fix): rerunning the whole
    // suite there would waste time re-proving cases a fresh compile-gate
    // race is timing-dependent about — only case b (the user's original
    // repro class) is worth re-running against the pre-fix tree.
    const CASE_FILTER = (process.argv[3] ?? "all").toLowerCase();
    const wantsA = CASE_FILTER === "all" || CASE_FILTER.includes("a");
    const wantsB = CASE_FILTER === "all" || CASE_FILTER.includes("b");
    const wantsC = CASE_FILTER === "all" || CASE_FILTER.includes("c");
    const wantsD = CASE_FILTER === "all" || CASE_FILTER.includes("d");
    const wantsE = CASE_FILTER === "all" || CASE_FILTER.includes("e");

    // ---- Case a: default scene — plain-affine WebGL arm --------------------
    let a = null;
    if (wantsA) {
      a = await runCase("a-default", "", "case-a-default");
    }

    // ---- Case b: escape-eligible scene — the user's original repro class --
    let b = null;
    if (wantsB && (!wantsA || (a && a.painted))) {
      b = await runCase("b-escape", `#${ESCAPE_HASH}`, "case-b-escape");
    } else if (wantsB) {
      console.error(
        "[surface-fallback] case a did not paint within budget; not descending to case b.",
      );
    }

    // ---- Case c: fold IFS class — slow GLSL link, best effort --------------
    let c = null;
    if (wantsC && (!wantsB || (b && b.painted))) {
      c = await runCase("c-fold", `#${FOLD_HASH}`, "case-c-fold");
    } else if (wantsC) {
      console.error(
        "[surface-fallback] case b did not paint within budget; not descending to case c.",
      );
    }

    // ---- Case d: 4D scene — the 4D cut's WebGL fallback arm ----------------
    // Deliberately NOT chained to case c's budget outcome: c's cost driver
    // (the fold-descent GLSL link) has nothing to do with d's (the
    // fragment 4D tracer, a different program entirely), so a slow/failed
    // fold compile says nothing about whether the 4D arm will compile
    // fine. Still gated behind wantsD so a caller can skip it.
    let d = null;
    if (wantsD) {
      // Tighter poll cadence than a/b/c: catching the "compute unavailable"
      // disclosure token needs the row observed mid-flight, and the 4D
      // fragment tracer's compile is fast enough under SwiftShader that
      // the shared 1500ms cadence routinely missed it entirely in earlier
      // runs (settle landed between polls). 250ms costs more screenshots
      // over a short session but doesn't touch a/b/c's already-proven
      // cadence.
      d = await runCase("d-4d", `#${PLAIN4_HASH}`, "case-d-4d", {
        expect4DDetailToken: true,
        pollMs: 250,
      });
    }

    // ---- Case e: fold-4D scene — the fold-4D REFUSAL arm -------------------
    // Not a render case at all: fold-shaped 4D systems have no fragment
    // arm, so a browser without WebGPU must refuse the mode with the
    // reason — a disabled control here is the PASS, and an enabled one
    // would mean a fold-blind tracer is about to render the wrong object.
    if (wantsE) {
      console.error(
        `[surface-fallback] ==== case e-fold4-refusal: #${FOLD4_HASH.slice(0, 24)}… ====`,
      );
      await gotoFresh(`${BASE}/#${FOLD4_HASH}`, {
        waitUntil: "load",
        timeout: 30_000,
      });
      await waitForPointCount();
      await page.waitForTimeout(1_000);
      const gpuGone = await page.evaluate(() => navigator.gpu === undefined);
      check(gpuGone, "e-fold4-refusal: navigator.gpu is undefined");
      const surfBtn = await page.$eval("#modeSurfaceBtn", (b) => ({
        disabled: b.disabled,
        title: b.title || "",
      }));
      check(
        surfBtn.disabled,
        `e-fold4-refusal: Surface control disabled (fold-4D needs compute)`,
      );
      check(
        /WebGPU/i.test(surfBtn.title),
        `e-fold4-refusal: reason names WebGPU (${surfBtn.title})`,
      );
    }

    console.error("[surface-fallback] ======== CASE SUMMARY ========");
    for (const r of caseResults) {
      console.error(
        `[surface-fallback] ${r.label}: entered=${r.entered} painted=${r.painted} diff=${r.finalDiffPct?.toFixed(1)}% elapsed=${r.elapsedMs}ms gpuUndefined=${r.gpuUndefined} contextLost=${r.contextLost} progressObservations=${r.progressObservations.length} sawComputeUnavailableToken=${r.sawComputeUnavailableToken}`,
      );
    }

    check(
      pageErrors.length === 0,
      `no page errors across the whole run (${pageErrors.join(" | ")})`,
    );
  } finally {
    if (page && !page.isClosed()) {
      const lost = await page
        .evaluate(() => window.__glLost)
        .catch(() => "unknown");
      console.error(`[surface-fallback] final context-lost tripwire: ${lost}`);
    }
    if (pageErrors.length) {
      console.error(
        `[surface-fallback] page errors: ${pageErrors.join(" | ")}`,
      );
    }
    await browser.close();
  }
  console.error("[surface-fallback] ======== SUMMARY ========");
  console.error(
    `[surface-fallback] VERDICT: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length}: ${failures.join("; ")})`}`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("[surface-fallback] fatal:", err);
  process.exitCode = 1;
});
