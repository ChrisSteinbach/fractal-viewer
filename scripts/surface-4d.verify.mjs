#!/usr/bin/env node
/**
 * The 4D cut's real-driver browser verification of the 4D surface
 * session's TWO arms now that a 4D surface session PREFERS the WebGPU
 * compute renderer (the new affine4 kernel core, `kind: "ifs4"` in
 * `surface-compute.ts`) — the fragment 4D tracer (`surface-material-4d.ts`)
 * is the fallback arm (`?surfacegl` / no adapter / device loss), exactly
 * mirroring how the 3D fold/escape kinds already worked before this cut.
 *
 * Unlike `surface-fallback.verify.mjs` (SwiftShader, `navigator.gpu`
 * stubbed away to force the fallback arm), THIS script drives a REAL
 * Chrome window against a REAL display so the COMPUTE arm actually has a
 * WebGPU adapter to find — the launch idiom is `scripts/gpu-flame-bench.mjs`'s
 * `--display` branch (real driver: `--enable-unsafe-webgpu`,
 * `--enable-features=Vulkan`, `--ignore-gpu-blocklist`, `--no-sandbox`,
 * NO `--headless=new`, NO SwiftShader flags, `env.DISPLAY` set) copied
 * verbatim, plus this project's `ignoreHTTPSErrors`/console-forwarding/
 * `emulateMedia({reducedMotion: "reduce"})` pattern.
 *
 * REDUCED MOTION IS REQUIRED here for a reason beyond the usual SwiftShader
 * settle-pinning trap: a 4D system auto-tumbles and NEVER settles under
 * normal motion (`four-d-view.ts`'s `tumbleOn` default), which would starve
 * every settle-based assertion below forever. Reduced motion's `reset()`
 * parks `tumbleOn` false and pre-seeds a deterministic (identity) rotor —
 * confirmed by reading `four-d-view.ts` directly — which is also what makes
 * the parity/IoU comparison between the two arms meaningful: both arms
 * render the exact same 4D pose, so a low IoU would mean a real rendering
 * difference, not two different camera angles of the same object.
 *
 * TWO SCENES (both minted the same way as surface-fallback.verify.mjs's
 * b/c/d hashes — a throwaway `npx tsx` script calling the app's own
 * initialState/toSnapshot/encodeScene, round-tripped through decodeScene,
 * and independently re-verified against systemPartsAreNonFlat +
 * analyzeSurfaceSystem4 both pre- and post-decode):
 *   - "plain4": the SAME light system as surface-fallback.verify.mjs's
 *     case d (three contracting affine maps, one with a live `w` block),
 *     flat kaleidoscope (order 1).
 *   - "kaleido4": two maps with live `w` blocks + an order-6 `xz`
 *     kaleidoscope with a twist-1 double rotation — order 6 +
 *     twist 1 was accepted directly at mint time (verified against
 *     `analyzeSurfaceSystem4`/`systemPartsAreNonFlat`), so no fallback to
 *     order 3 was needed.
 *
 * PER SCENE:
 *   a. load `#v1=...`, wait for boot, click #modeSurfaceBtn (compute arm:
 *      no `?surfacegl`).
 *   b. bounded combined poll (150ms cadence): console line containing
 *      "WebGPU compute tracer active", `#surfaceProgress` text containing
 *      "· WebGPU" at least once, then the session SETTLES (row hidden AND
 *      two consecutive canvas screenshots ~1.5s apart byte-identical).
 *      Any FAILURE here (no compute-active line, no WebGPU progress
 *      sample, or a settle timeout) dumps the full console log + a
 *      screenshot and STOPS this scene's protocol — no improvised
 *      recovery, per the task brief.
 *   c. LIVENESS on the settled compute session: open the "4D View"
 *      accordion section (closed by default under `surfaceColorSection`'s
 *      auto-open — see ui.ts's `openSectionByMode`), focus
 *      `#fourDSliceSlider`, press ArrowRight 30 times (keyboard, not
 *      pointer drag — avoids touch/scroll traps), assert the canvas
 *      changed, then assert it re-settles.
 *   d. FALLBACK A/B: reload the SAME hash with `?surfacegl` appended,
 *      assert NO "WebGPU compute tracer active" console line ever
 *      appears, assert any visible progress text says "· WebGL" with NO
 *      trailing detail token (the deliberate-flag rule —
 *      `render-backend.ts`'s `surfaceWebglDetail` returns null for
 *      `block === "flag"`), settle.
 *   e. PARITY: an object-mask IoU between the two arms' settled canvas
 *      PNGs, computed INSIDE THE BROWSER (no new npm dependency): decode
 *      both PNGs onto a `<canvas>`, classify each pixel as object/
 *      background by whether it deviates more than 12/255 from its ROW's
 *      median luminance (the backdrop is a smooth vertical gradient), and
 *      intersect/union the two boolean masks. >= 0.8 reported as-is,
 *      [0.5, 0.8) as WARN (lighting/dither may legitimately differ),
 *      < 0.5 as FAIL.
 *      WHAT PARITY DOES NOT COVER, disclosed rather than fixed:
 *      the CENTRED slice is the only one it ever compares. Step (d) is a
 *      fresh navigation to the same hash, which carries no `FourDPose`, so
 *      both settled PNGs are taken at `w0 = 0` and step (c)'s off-centre
 *      session is discarded before the masks are built. An arm that drew a
 *      different object OFF centre — the region the off-centre slice
 *      investigation is about — would pass this gate at IoU 1.0. Closing
 *      it means a third settle at a nonzero slice on each arm, which is
 *      the cost this script has so far declined to pay.
 *
 * Usage: node scripts/surface-4d.verify.mjs [url] [sceneFilter]
 * (url defaults to https://localhost:5173 — start a dev server first;
 * sceneFilter is a substring match over "plain4kaleido4", default "all".)
 * Requires a real X display (DISPLAY=:0 hardcoded below — this is a
 * real-driver script, not a SwiftShader one). Screenshots + console dumps
 * land in .playwright-mcp/ (gitignored). RUNTIME: the kaleido4 leg alone
 * can take over ten minutes end to end — its `?surfacegl` fallback arm's
 * settle is measured up to 637.5s on this hardware, and
 * KALEIDO4_ARM_BUDGET_MS below is sized to that, not to a quick number.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", ".playwright-mcp");
const BASE = (process.argv[2] ?? "https://localhost:5173").replace(/\/+$/, "");
const SCENE_FILTER = (process.argv[3] ?? "all").toLowerCase();

// Long-window OBSERVE mode (a 4D-cut follow-up, kaleido4 A/B): bypasses the
// normal per-scene protocol (runArm/testLiveness/computeIoU) entirely and
// instead watches ONE arm at a time for `minutes` (default 6) via a
// gap-free MutationObserver log — a polling read of #surfaceProgress can
// miss a state that writes and reverts between two poll ticks (this
// script's own earlier settle-detection bug found exactly that shape of
// mistake), so this mode never polls the DOM for progress at all; it only
// ever reads the accumulated window.__progressLog, which cannot have gaps
// because the observer fires on every actual mutation regardless of when
// Node chooses to look. --arm selects which arm(s) to observe.
const EXTRA_ARGS = process.argv.slice(4);
const OBSERVE_FLAG = EXTRA_ARGS.find(
  (a) => a === "--observe" || a.startsWith("--observe="),
);
const OBSERVE_MODE = OBSERVE_FLAG !== undefined;
const OBSERVE_MINUTES = OBSERVE_FLAG?.includes("=")
  ? Number(OBSERVE_FLAG.split("=")[1])
  : 6;
const ARM_FLAG = EXTRA_ARGS.find((a) => a.startsWith("--arm="));
/** "compute" | "surfacegl" | "both" */
const ARM_SELECT = ARM_FLAG ? ARM_FLAG.split("=")[1] : "both";

// Post-drag re-settle instruments: `--force-liveness` runs the w-slice drag
// leg even on fragment-routed scenes (the leg normally pins the COMPUTE
// arm's per-frame view4 re-read, so it skips scenes EXPECT_COMPUTE_BY_SCENE
// routes to the fragment tracer — kaleido4's fragment-arm post-drag
// re-settle was exactly that bug, so the repro needed the leg back).
// VESTIGIAL SINCE THE ROUTING RE-MEASUREMENT: EXPECT_COMPUTE_BY_SCENE has
// no fragment-routed entry left (routing no longer splits by symmetry order
// at all — see the table below), so the skip this flag exists to bypass
// never fires today and every scene's liveness leg already runs
// unconditionally; the flag stays rather than getting deleted because it is
// still that repro instrument the moment a future scene IS fragment-routed
// again. `--query=<qs>` appends extra query params (no leading "?") to
// every arm's URL — `--query=surfperf` turns on scene.ts's strip/evidence
// logging, that diagnosis' channel.
const FORCE_LIVENESS = EXTRA_ARGS.includes("--force-liveness");
const QUERY_FLAG = EXTRA_ARGS.find((a) => a.startsWith("--query="));
const EXTRA_QUERY = QUERY_FLAG ? QUERY_FLAG.split("=").slice(1).join("=") : "";

// ROUTING-VERIFY mode (supersedes 916813c's shape-keyed split):
// the 4D branch no longer routes by symmetry order at all. 916813c had
// introduced `compute4Shaped = de.symmetry.order <= 1` — plain 4D (order
// 1) preferring compute, kaleidoscope 4D (order > 1) going straight to
// the fragment tracer as a "measured home, not a fallback" — and the
// shade-sizer width fix REMOVED that split: main.ts now prefers the WebGPU
// compute renderer for EVERY 4D session with an adapter, plain or
// kaleidoscope alike, and the fragment 4D tracer is purely the FALLBACK
// arm (`?surfacegl` / no adapter / device loss), exactly what the module
// doc's opening paragraph already describes. MEASURED, real Iris Xe TGL
// GT2 through ANGLE/Mesa, 1024x640, identity rotor, centred slice,
// production build, one fresh session per cell, both arms FORCED via
// `?surfacegl`/`?surfacecompute` (`scripts/slice-cliff.probe.mjs ...
// --arm=both --slices=0 --settle=1`): kaleido4 (2 maps, order 6, twist 1)
// settled WebGL 637.5s against compute 53.1s — the order split was
// costing this scene 12x, not the cheap "measured home" 916813c had
// recorded — while plain4 (3 maps, order 1) settled WebGL 11.5s against
// compute 3.0s either way. That same fix's hit-shade batch sizer is why
// compute is 3.3x faster than the 179s this file used to cite for it.
// Always the PLAIN hash URL — no ?surfacegl, no navigator.gpu stub —
// WebGPU genuinely available, so a real routing decision is being
// exercised, not a forced fallback.
const VERIFY_ROUTING_MODE = EXTRA_ARGS.includes("--verify-routing");
/** name -> whether main.ts's routing should land this scene on compute.
 * ALL THREE read true now the order-keyed split is gone, but for two
 * different reasons kept distinct in this table on purpose:
 * plain4/kaleido4 have a real fragment fallback and compute is simply the
 * measured-faster PREFERENCE whenever an adapter exists (kaleido4's own
 * default-routing session measures engine=compute, settled 70.1s,
 * comfortably inside DEFAULT_ARM_BUDGET_MS's 90s below), while fold4 is
 * compute-ONLY (no fold GLSL exists to fall back to — see
 * EXPECT_WEBGL_REFUSAL_BY_SCENE below). The table stays rather than
 * collapsing to a bare constant so a future routing change that
 * reintroduces any split edits this one place and every mode that reads
 * it follows. */
const EXPECT_COMPUTE_BY_SCENE = { plain4: true, kaleido4: true, fold4: true };
/** Scenes whose ?surfacegl arm asserts the ELIGIBILITY REFUSAL instead of
 * a WebGL render (fold-shaped 4D systems have no fragment arm — forcing
 * WebGL makes compute unavailable, and the gate refuses with the WebGPU
 * reason rather than letting a fold-blind tracer render). UNTOUCHED by the
 * routing change — fold-shaped 4D was already compute-only for a reason
 * that has nothing to do with the order-keyed split it removed. */
const EXPECT_WEBGL_REFUSAL_BY_SCENE = { fold4: true };

// TUMBLE-PARK verify mode (uncommitted working tree): the 4D
// ambient auto-tumble now PARKS during a live surface session
// (main.ts's surface tick: `if (fourDTween.active) advanceFourDPose(dt4)`
// — ambient ticks skipped, directed pose glides still live) and the panel
// hides #fourDTumbleToggleRow + #fourDTumbleRow while a live 4D surface
// session shows (ui.ts's syncFourDViewRows). Previously the tumble
// invalidated every frame and the settle never armed WITHOUT
// reducedMotion -- which is why every other mode in this script emulates
// it and none of them ever saw this bug. This mode deliberately does NOT
// emulate reducedMotion -- that is the whole point -- so it is gated
// through its own page-setup branch rather than the shared one.
const TUMBLE_PARK_MODE = EXTRA_ARGS.includes("--verify-tumble-park");
/** Generous for a first-ever no-reducedMotion settle measurement -- this
 * mode exists specifically to find out what that number even is. */
const TUMBLE_PARK_BUDGET_MS = 60_000;

/** The real X display this script drives Chrome against — see the module
 * doc's launch-idiom paragraph. Confirmed live (`xdpyinfo`) before writing
 * this script. */
const REAL_DISPLAY = ":0";

// ---------------------------------------------------------------------------
// Minted scenes (see the module doc for provenance + eligibility math).
// ---------------------------------------------------------------------------

/** Scene A "plain4": three contracting affine maps, one carrying a live
 * `w` block (position 0.5, an xw rotation of 0.3), flat kaleidoscope.
 * Byte-identical to surface-fallback.verify.mjs's case-d hash. */
const PLAIN4_HASH =
  "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNSwwLDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInciOnsicG9zaXRpb24iOjAuNSwicm90YXRpb24iOnsieHciOjAuM319fSx7InBvc2l0aW9uIjpbLTAuMjUsMC40MywwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMjUsLTAuNDMsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MX0";

/** Scene B "kaleido4": two maps with live `w` blocks + an order-6 `xz`
 * kaleidoscope with a twist-1 double rotation. */
const KALEIDO4_HASH =
  "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidyI6eyJwb3NpdGlvbiI6MC40LCJyb3RhdGlvbiI6eyJ4dyI6MC4zfX19LHsicG9zaXRpb24iOlstMC40LC0wLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidyI6eyJwb3NpdGlvbiI6LTAuNCwicm90YXRpb24iOnsieXciOjAuM319fV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjo2LCJwbGFuZSI6Inh6IiwidHdpc3QiOjF9LCJnbG93QnJpZ2h0bmVzcyI6MX0";

// The 4D fold-branch port's scene — the CPU/GPU fold fixtures' pure-
// boxfold pair (two 0.5-scale maps with live w blocks, boxfold weight 1
// each, order 1), minted the same initialState/toSnapshot/encodeScene way
// as the two above. Fold-shaped 4D systems are COMPUTE-ONLY (the fragment
// 4D tracer carries no fold GLSL), so this scene's ?surfacegl arm asserts
// the REFUSAL — Surface disabled with the WebGPU reason — not a render.
const FOLD4_HASH =
  "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6ImJveGZvbGQiLCJ3ZWlnaHQiOjF9XSwidyI6eyJwb3NpdGlvbiI6MC4zLCJyb3RhdGlvbiI6eyJ4dyI6MC4zfX19LHsicG9zaXRpb24iOlstMC40LC0wLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6ImJveGZvbGQiLCJ3ZWlnaHQiOjF9XSwidyI6eyJwb3NpdGlvbiI6LTAuMywicm90YXRpb24iOnsieXciOjAuMjV9fX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MX0";

/** Overall budget for one arm's console+progress+settle poll (real
 * hardware; measured compute settles elsewhere in this codebase run
 * ~1-55s even for MUCH heavier systems, so this is generous headroom, not
 * a tight bound) — the default for every scene/arm pair except kaleido4's
 * fragment leg, which needs KALEIDO4_ARM_BUDGET_MS below. plain4 and
 * fold4 settle well inside this on either arm (measured: plain4 WebGL
 * 11.5s / compute 3.0s), and kaleido4's OWN compute arm does too — its
 * default (un-flagged) session measures engine=compute, settled 70.1s,
 * comfortably inside 90s. */
const DEFAULT_ARM_BUDGET_MS = 90_000;
/**
 * kaleido4's fragment arm is the one scene/arm pair DEFAULT_ARM_BUDGET_MS
 * cannot cover, and the number is measured, not guessed. The width fix's
 * real-Iris probe (`scripts/slice-cliff.probe.mjs --arm=both --slices=0
 * --settle=1`, identity rotor, centred slice, production build, one
 * fresh session per cell, both arms FORCED via
 * `?surfacegl`/`?surfacecompute`) put kaleido4's WebGL settle at 637.5s
 * against its own compute arm's 53.1s. The WebGL number is not even
 * stable: the fragment tracer's strip pump prices a scene's cost
 * class-pessimistic and ratchets up off the job's OWN measurements (see
 * `strip-planner.ts`'s doc), so an expensive scene's total is
 * PATH-DEPENDENT — this same scene has been measured settling in 147s,
 * 444s, 604s and 637.5s run to run on this hardware, against the compute
 * arm's ~5% spread. 700000 (700s) clears the WORST observed run (637.5s)
 * with real headroom rather than the mean, because step (d) — the
 * `?surfacegl` fallback A/B — MUST reach a settled PNG or step (e)'s IoU
 * parity comparison has nothing to compare against; a budget sized to the
 * typical run would make this scene's leg flake exactly on the strip
 * pump's worst day. THIS IS NOT A NUMBER TO QUIETLY RAISE (OR SHRINK)
 * WITHOUT A NEW MEASUREMENT BEHIND IT — it is the honest cost of a
 * fragment-arm settle on an order-6 4D scene, and it is why the kaleido4
 * leg of this script can take over ten minutes to run end to end.
 * Applied to the WHOLE scene (both arms), not the fragment arm alone,
 * because a scene — not an arm — is this file's unit of budgeting (see
 * SCENES below); the compute arm's own poll simply returns the moment it
 * settles at ~70s regardless of a 90s or 700s ceiling, so the oversized
 * allowance on that arm costs nothing.
 */
const KALEIDO4_ARM_BUDGET_MS = 700_000;

const SCENES = [
  { name: "plain4", hash: PLAIN4_HASH, budgetMs: DEFAULT_ARM_BUDGET_MS },
  { name: "kaleido4", hash: KALEIDO4_HASH, budgetMs: KALEIDO4_ARM_BUDGET_MS },
  { name: "fold4", hash: FOLD4_HASH, budgetMs: DEFAULT_ARM_BUDGET_MS },
].filter((s) => SCENE_FILTER === "all" || SCENE_FILTER.includes(s.name));

/** Playwright's per-action default timeout must cover the slowest arm
 * this script can ever run, whichever scene's turn it currently is — the
 * poll loops below race their OWN scene-specific deadline
 * (t0 + scene.budgetMs) against it, so this only needs to be a safe upper
 * bound, not a tight one. */
const MAX_ARM_BUDGET_MS = Math.max(
  DEFAULT_ARM_BUDGET_MS,
  KALEIDO4_ARM_BUDGET_MS,
);
/** Cadence for the console/progress scan within the combined poll — fast
 * enough that a quick compute preview isn't missed between polls. */
const FAST_POLL_MS = 150;
/** Minimum spacing between settle-checkpoint screenshots (the "~1.5s
 * apart" byte-identity check the task brief specifies). */
const SETTLE_CHECK_INTERVAL_MS = 1_500;
/** Same 2%-of-PNG-bytes threshold surface-fallback.verify.mjs uses for
 * "materially different canvas". */
const PAINT_DIFF_PCT = 2;

const failures = [];
function check(ok, label) {
  console.error(`[surface-4d] ${ok ? "ok " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
}

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
  const env = { ...process.env, DISPLAY: REAL_DISPLAY };
  // Real-driver launch idiom (scripts/gpu-flame-bench.mjs's --display
  // branch, copied verbatim): WebGPU reaches the real GPU through Vulkan,
  // independent of the SwiftShader/ANGLE flags a WebGL-only script needs
  // — and NONE of those SwiftShader flags are present here, deliberately.
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false,
    env,
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
    ],
  });
  const pageErrors = [];
  const consoleMessages = [];
  let page = null;
  /** {scene, arm, ...} rows for the final timing/evidence tables. */
  const armResults = [];
  const iouResults = [];
  try {
    page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1024, height: 640 },
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
      console.error(`[page:${msg.type()}] ${msg.text()}`);
    });
    page.setDefaultTimeout(MAX_ARM_BUDGET_MS + 30_000);
    // REQUIRED here beyond the usual SwiftShader reason: a 4D system
    // auto-tumbles and never settles under normal motion; reduced motion
    // parks the tumble at a deterministic (identity) rotor (confirmed by
    // reading four-d-view.ts's reset()), which is also what makes the
    // compute-vs-fallback IoU comparison meaningful (same pose, not two
    // different camera angles of the same object). TUMBLE_PARK_MODE is
    // the deliberate exception: it exists specifically to verify the
    // tumble-park fix under NORMAL (non-reduced) motion, since reducedMotion
    // masked the bug in every other mode here.
    if (!TUMBLE_PARK_MODE) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    // Gap-free progress history via MutationObserver, installed fresh on
    // EVERY navigation (addInitScript persists across this page's
    // page.goto calls): records every actual DOM mutation of
    // #surfaceProgress as it happens, so reading window.__progressLog
    // later is a complete transcript, not a poll-cadence sample that can
    // miss a write-then-revert between two ticks. Used by observeArm
    // (OBSERVE mode); the normal runArm/pollUntilSettled path still polls
    // the live DOM directly and does not depend on this.
    await page.addInitScript(() => {
      window.__progressLog = [];
      function record(el) {
        window.__progressLog.push({
          t: Date.now(),
          visible: !el.classList.contains("hidden"),
          text: el.textContent,
        });
      }
      function install() {
        const el = document.getElementById("surfaceProgress");
        if (!el) {
          requestAnimationFrame(install);
          return;
        }
        record(el);
        new MutationObserver(() => record(el)).observe(el, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", install);
      } else {
        install();
      }
    });

    // CRITICAL: page.goto() between two URLs that differ ONLY in the hash
    // fragment (same origin+path+query) is a SAME-DOCUMENT navigation per
    // web platform semantics -- the browser does NOT reload the page, so
    // the app's JS context (and with it, whatever scene was already
    // loaded) survives untouched. The app has no `hashchange` listener
    // (grepped: none exists) -- `loadScene()` only ever runs once at
    // initial boot -- so a second `page.goto(differentHashSameOrigin)`
    // silently strands the session on the FIRST scene forever, while
    // location.hash in the address bar still updates (confirmed
    // empirically with a throwaway diagnostic: a window.__marker set
    // after the first load survives a second goto to a different-hash,
    // same-origin, same-query URL; it does NOT survive when the query
    // string also changes, e.g. adding/removing ?surfacegl). This
    // wrapper forces a REAL navigation every time by bouncing through
    // about:blank first -- the standard fix for this exact Playwright
    // trap -- so no caller here can ever be silently testing a stale
    // scene from a previous step.
    async function gotoFresh(url, opts) {
      await page.goto("about:blank");
      await page.goto(url, opts);
    }

    const canvasShot = (name) =>
      page
        .locator("canvas")
        .first()
        .screenshot({
          type: "png",
          ...(name ? { path: path.join(OUT_DIR, name) } : {}),
        });

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
     * Combined bounded poll: scans new console messages for
     * "WebGPU compute tracer active" and "Surface compute preview" lines,
     * records every distinct (visible, text) #surfaceProgress sample, and
     * checks for settle (row hidden AND two canvas screenshots >=1.5s
     * apart byte-identical) every SETTLE_CHECK_INTERVAL_MS. Mutates
     * `result` in place; returns { settled, elapsedMs }.
     */
    async function pollUntilSettled(result, t0, consoleBaseIdx, deadline) {
      let lastCheckpointShot = null;
      // The settle verdict must not fire before the session has PRESENTED
      // anything: a slow renderer create (measured: the fold4 compute
      // session compiles four fold-frontier kernels, ~3s on Iris) leaves
      // the canvas showing the previous mode's static point cloud with
      // the progress row hidden — two identical checkpoints there read
      // "settled" while the engine line prints just after the poll
      // returns. A surface render never byte-matches the point cloud, so
      // requiring one canvas CHANGE since entry closes the window without
      // caring which engine the arm runs.
      const entryShot = await canvasShot(null);
      // Bug fixed during verification: this MUST start at the loop's own
      // start time, not 0 -- Date.now() is an absolute epoch value, so a
      // 0 baseline made "now - lastCheckpointAt >= SETTLE_CHECK_INTERVAL_MS"
      // true on the very FIRST iteration (epoch millis are always >>
      // 1500), collapsing the intended ~1.5s-apart byte-identity check
      // into a ~150ms-apart one and reporting false "settled" on scenes
      // whose canvas happens to look unchanged for one fast-poll tick
      // (observed: kaleido4's compute arm settling in 1680ms and never
      // showing "· WebGPU" progress, when the console's own "Surface
      // compute settle" line reported multi-second multi-pass work still
      // in flight).
      let lastCheckpointAt = Date.now();
      for (;;) {
        const now = Date.now();
        const newConsole = consoleMessages.slice(consoleBaseIdx);
        if (
          !result.computeActiveSeen &&
          newConsole.some((m) =>
            m.text.includes("WebGPU compute tracer active"),
          )
        ) {
          result.computeActiveSeen = true;
        }
        for (const m of newConsole) {
          if (
            m.text.startsWith("Surface compute preview") &&
            !result.previewLines.includes(m.text)
          ) {
            result.previewLines.push(m.text);
          }
        }
        const progress = await readSurfaceProgress();
        const lastObs = result.progressSamples.at(-1);
        if (
          !lastObs ||
          lastObs.visible !== progress.visible ||
          lastObs.text !== progress.text
        ) {
          result.progressSamples.push({ ...progress, atMs: now - t0 });
        }
        // Engine evidence is the TEXT, not the row's visibility: the row
        // hides between paints and on fast settles the 150ms cadence can
        // land every poll in a hidden moment (measured: kaleido4 settling
        // in ~6s produced only hidden "· WebGL 91%" samples and flaked
        // the arm) — the engine token identifies the arm either way.
        if (progress.text) {
          if (progress.text.includes("· WebGPU"))
            result.webgpuProgressSeen = true;
          if (progress.text.includes("· WebGL"))
            result.webglProgressSeen = true;
        }

        if (now - lastCheckpointAt >= SETTLE_CHECK_INTERVAL_MS) {
          const shot = await canvasShot(null);
          if (
            lastCheckpointShot &&
            shot.equals(lastCheckpointShot) &&
            !shot.equals(entryShot) &&
            !progress.visible
          ) {
            return { settled: true, elapsedMs: now - t0, shot };
          }
          lastCheckpointShot = shot;
          lastCheckpointAt = now;
        }
        if (now > deadline) {
          return {
            settled: false,
            elapsedMs: now - t0,
            shot: lastCheckpointShot ?? (await canvasShot(null)),
          };
        }
        await page.waitForTimeout(FAST_POLL_MS);
      }
    }

    /** Object-mask IoU between two settled canvas PNGs, computed entirely
     * inside the page (no new npm dependency): per-row median-luminance
     * background classifier, threshold 12/255. */
    async function computeIoU(pngA, pngB) {
      return page.evaluate(
        async ({ a, b }) => {
          async function decode(base64) {
            const img = new Image();
            img.src = `data:image/png;base64,${base64}`;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            return {
              data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
              width: canvas.width,
              height: canvas.height,
            };
          }
          const imgA = await decode(a);
          const imgB = await decode(b);
          if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
            return {
              error: `size mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`,
            };
          }
          const { width, height } = imgA;
          function maskOf(img) {
            const mask = new Uint8Array(width * height);
            const rowLum = new Float64Array(width);
            for (let y = 0; y < height; y++) {
              for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                rowLum[x] =
                  0.299 * img.data[i] +
                  0.587 * img.data[i + 1] +
                  0.114 * img.data[i + 2];
              }
              const sorted = Array.from(rowLum).sort((p, q) => p - q);
              const median = sorted[Math.floor(sorted.length / 2)];
              for (let x = 0; x < width; x++) {
                mask[y * width + x] = Math.abs(rowLum[x] - median) > 12 ? 1 : 0;
              }
            }
            return mask;
          }
          const maskA = maskOf(imgA);
          const maskB = maskOf(imgB);
          let intersection = 0;
          let union = 0;
          let countA = 0;
          let countB = 0;
          for (let i = 0; i < maskA.length; i++) {
            const va = maskA[i];
            const vb = maskB[i];
            if (va) countA++;
            if (vb) countB++;
            if (va && vb) intersection++;
            if (va || vb) union++;
          }
          return {
            width,
            height,
            countA,
            countB,
            intersection,
            union,
            iou: union > 0 ? intersection / union : null,
          };
        },
        { a: pngA.toString("base64"), b: pngB.toString("base64") },
      );
    }

    /** One arm (compute or WebGL fallback) of one scene. */
    async function runArm(scene, armLabel, { forceWebgl }) {
      const qs = [forceWebgl ? "surfacegl" : "", EXTRA_QUERY]
        .filter(Boolean)
        .join("&");
      const url = `${BASE}/${qs ? `?${qs}` : ""}#${scene.hash}`;
      console.error(`[surface-4d] ==== ${scene.name}/${armLabel}: ${url} ====`);
      const result = {
        scene: scene.name,
        arm: armLabel,
        computeActiveSeen: false,
        webgpuProgressSeen: false,
        webglProgressSeen: false,
        previewLines: [],
        progressSamples: [],
        settled: false,
        settleMs: null,
        aborted: false,
        abortReason: null,
        screenshotPath: null,
        settledShotBuf: null,
      };
      const consoleBaseIdx = consoleMessages.length;
      const pageErrorsBefore = pageErrors.length;

      await gotoFresh(url, { waitUntil: "load", timeout: 30_000 });
      await waitForPointCount();
      await armContextLossTripwire();
      await page.waitForTimeout(1_000);

      const disabled = await page.$eval("#modeSurfaceBtn", (b) => b.disabled);
      // A fold-shaped 4D scene's ?surfacegl arm EXPECTS the
      // refusal — compute is unavailable by the flag's own hand and no
      // fragment arm exists, so a disabled Surface control naming the
      // WebGPU reason IS the pass, and the arm ends here (nothing to
      // settle, nothing to screenshot).
      if (forceWebgl && (EXPECT_WEBGL_REFUSAL_BY_SCENE[scene.name] ?? false)) {
        check(
          disabled,
          `${scene.name}/${armLabel}: Surface control refused under ?surfacegl (fold-4D has no fragment arm)`,
        );
        if (disabled) {
          const reason = await page
            .$eval("#modeSurfaceBtn", (b) => b.title || "")
            .catch(() => "");
          check(
            /WebGPU/i.test(reason),
            `${scene.name}/${armLabel}: refusal names WebGPU (${reason})`,
          );
        }
        result.aborted = !disabled;
        result.abortReason = disabled ? null : "expected refusal, got enabled";
        result.refused = disabled;
        armResults.push(result);
        return result;
      }
      check(
        !disabled,
        `${scene.name}/${armLabel}: Surface mode control enabled`,
      );
      if (disabled) {
        result.aborted = true;
        result.abortReason = "Surface mode control disabled";
        armResults.push(result);
        return result;
      }

      const t0 = Date.now();
      await page.click("#modeSurfaceBtn");

      const poll = await pollUntilSettled(
        result,
        t0,
        consoleBaseIdx,
        t0 + scene.budgetMs,
      );
      result.settled = poll.settled;
      result.settleMs = poll.elapsedMs;

      const failReasons = [];
      if (!forceWebgl) {
        // The un-flagged arm asserts main.ts's actual ROUTING DECISION for
        // this scene against EXPECT_COMPUTE_BY_SCENE — the same
        // expectation table --verify-routing uses, so a future routing
        // change edits that one table and both modes follow. The width
        // fix removed the order-keyed split this used to test (commit
        // 85918b5's `order <= 1` -> compute / `order > 1` -> fragment
        // rule, re-verified as 916813c): every entry reads true today,
        // because a scene either prefers compute unconditionally or —
        // fold4 only — has no fragment arm to fall back to at all. (This
        // branch asserted compute unconditionally when the script
        // predated the 916813c routing split, which failed kaleido4's
        // then-correctly-fragment-routed session as if it were a
        // regression — the table exists to prevent exactly that failure
        // mode regardless of which way routing points.)
        const expectCompute = EXPECT_COMPUTE_BY_SCENE[scene.name] ?? true;
        if (expectCompute) {
          if (!result.computeActiveSeen) {
            failReasons.push('no "WebGPU compute tracer active" console line');
          }
          if (!result.webgpuProgressSeen) {
            failReasons.push('#surfaceProgress never showed "· WebGPU" text');
          }
        } else {
          if (result.computeActiveSeen) {
            failReasons.push(
              "un-flagged session took the compute arm where " +
                "EXPECT_COMPUTE_BY_SCENE says fragment",
            );
          }
          if (!result.webglProgressSeen) {
            failReasons.push('#surfaceProgress never showed "· WebGL" text');
          }
        }
      } else {
        if (result.computeActiveSeen) {
          failReasons.push(
            '?surfacegl session still claimed "WebGPU compute tracer active"',
          );
        }
      }
      if (!result.settled) failReasons.push("never settled within budget");

      if (failReasons.length > 0) {
        // Per the task brief: capture full console log + screenshot and
        // STOP this scene's protocol — no improvised recovery.
        const dumpName = `${scene.name}-${armLabel}-FAILURE`;
        const failShot = await canvasShot(`${dumpName}.png`);
        const dumpPath = path.join(OUT_DIR, `${dumpName}-console.log`);
        await writeFile(
          dumpPath,
          consoleMessages
            .slice(consoleBaseIdx)
            .map((m) => `[${m.type}] ${m.text}`)
            .join("\n") +
            `\n\n-- pollResult --\n${JSON.stringify(poll.settled ? { settled: true } : { settled: false }, null, 2)}` +
            `\n-- progressSamples --\n${JSON.stringify(result.progressSamples, null, 2)}`,
        );
        result.aborted = true;
        result.abortReason = failReasons.join("; ");
        result.screenshotPath = `${dumpName}.png`;
        result.settledShotBuf = failShot;
        check(
          false,
          `${scene.name}/${armLabel}: ${failReasons.join("; ")} (console+screenshot dumped: ${dumpName}.*)`,
        );
        armResults.push(result);
        return result;
      }

      check(true, `${scene.name}/${armLabel}: settled in ${result.settleMs}ms`);
      // Fallback arm's own detail-token rule: the deliberate ?surfacegl
      // flag must carry NO trailing " — compute ..." caveat.
      //
      // THE ANTIALIASING TOKEN IS NOT THAT CAVEAT and has to be stripped
      // before the question is asked. The WebGL strip arm was given the
      // same 8-sample supersampling the compute path has, and the progress
      // row discloses the pass as its own trailing
      // "— antialiasing pass k/8"; this assertion predates that and had
      // been failing on every WebGL settle long enough to reach pass 2,
      // which is all of them. What the rule is actually about is
      // `surfaceWebglDetail`'s ENGINE explanation, which always names
      // "compute" — so anything else that legitimately grows a trailing
      // token belongs on this list rather than in the failure.
      const AA_PASS_TOKEN = / — antialiasing pass \d+\/\d+$/;
      if (forceWebgl) {
        const shownTexts = result.progressSamples.filter(
          (o) => o.visible && o.text,
        );
        if (shownTexts.length > 0) {
          check(
            shownTexts.every(
              (o) =>
                o.text.includes("· WebGL") &&
                !o.text.replace(AA_PASS_TOKEN, "").includes(" — "),
            ),
            `${scene.name}/${armLabel}: visible progress says "· WebGL" with no detail token (${shownTexts.map((o) => o.text).join(" | ")})`,
          );
        } else {
          console.error(
            `[surface-4d] ${scene.name}/${armLabel}: #surfaceProgress never observed visible (settled faster than the poll cadence) -- WebGL-label check not asserted.`,
          );
        }
      }

      const screenshotName = `${scene.name}-${forceWebgl ? "surfacegl" : "compute"}.png`;
      const settledShot = await canvasShot(screenshotName);
      result.screenshotPath = screenshotName;
      result.settledShotBuf = settledShot;

      result.newPageErrors = pageErrors.slice(pageErrorsBefore);
      check(
        result.newPageErrors.length === 0,
        `${scene.name}/${armLabel}: no page errors (${result.newPageErrors.join("|")})`,
      );

      armResults.push(result);
      return result;
    }

    /** Liveness on the (already settled) compute arm: keyboard-drag the
     * w-slice slider and assert the canvas changes, then re-settles. */
    async function testLiveness(scene, settledShot) {
      console.error(`[surface-4d] ==== ${scene.name}/liveness ====`);
      // The "4D View" accordion section is closed by default in Surface
      // mode (surfaceColorSection auto-opens instead — ui.ts's
      // openSectionByMode) even though the section itself is visible for
      // a non-flat document in a live (non-frozen) render — click its
      // summary to expand it, a normal user action.
      const summary = page.locator("#fourDControls > summary");
      const isOpen = await page
        .locator("#fourDControls")
        .evaluate((el) => el.open);
      if (!isOpen) await summary.click();
      const slider = page.locator("#fourDSliceSlider");
      await slider.waitFor({ state: "visible", timeout: 10_000 });
      await slider.focus();
      const t0 = Date.now();
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("ArrowRight");
      }
      await page.waitForTimeout(300);
      const afterDrag = await canvasShot(`${scene.name}-liveness-during.png`);
      const diffPct = pngDiffPct(settledShot, afterDrag);
      check(
        diffPct > PAINT_DIFF_PCT,
        `${scene.name}/liveness: w-slice keyboard drag changed the canvas (diff ${diffPct.toFixed(1)}%)`,
      );

      const consoleBaseIdx = consoleMessages.length;
      const reResult = {
        computeActiveSeen: true, // not re-checked; already proven this arm
        webgpuProgressSeen: false,
        webglProgressSeen: false,
        previewLines: [],
        progressSamples: [],
      };
      const poll = await pollUntilSettled(
        reResult,
        t0,
        consoleBaseIdx,
        Date.now() + scene.budgetMs,
      );
      check(
        poll.settled,
        `${scene.name}/liveness: re-settled after slider drag in ${poll.elapsedMs}ms`,
      );
      await canvasShot(`${scene.name}-liveness-resettled.png`);
      return { diffPct, resettleMs: poll.settled ? poll.elapsedMs : null };
    }

    /**
     * OBSERVE mode (a 4D-cut follow-up): watch ONE arm for `minutes`
     * (default 6, not this script's normal per-scene `budgetMs` --
     * DEFAULT_ARM_BUDGET_MS's 90s, or KALEIDO4_ARM_BUDGET_MS's 700s for
     * kaleido4's fragment leg) using window.__progressLog
     * (installed above) instead of racing a poll loop. Records a screenshot
     * every 60s plus a final one, drains "Surface compute preview/settle"
     * console lines, and checks settle (row hidden AND two canvas
     * screenshots >=1.5s apart byte-identical -- the SAME definition
     * pollUntilSettled uses) at a coarse cadence, since there is no fast
     * transition to race here, only a slow grind to document faithfully.
     */
    async function observeArm(scene, armLabel, { forceWebgl, minutes }) {
      const url = forceWebgl
        ? `${BASE}/?surfacegl#${scene.hash}`
        : `${BASE}/#${scene.hash}`;
      console.error(
        `[surface-4d] ==== OBSERVE ${scene.name}/${armLabel} (${minutes}min): ${url} ====`,
      );
      const result = {
        scene: scene.name,
        arm: armLabel,
        aborted: false,
        abortReason: null,
        settled: false,
        settleAtMs: null,
        progressLog: [],
        previewLines: [],
        settleLines: [],
        screenshots: [],
        computeActiveSeen: false,
      };

      await gotoFresh(url, { waitUntil: "load", timeout: 30_000 });
      await waitForPointCount();
      await armContextLossTripwire();
      await page.waitForTimeout(1_000);

      const disabled = await page.$eval("#modeSurfaceBtn", (b) => b.disabled);
      check(
        !disabled,
        `${scene.name}/${armLabel}: Surface mode control enabled`,
      );
      if (disabled) {
        result.aborted = true;
        result.abortReason = "Surface mode control disabled";
        return result;
      }

      const consoleBaseIdx = consoleMessages.length;
      const t0 = Date.now();
      await page.click("#modeSurfaceBtn");

      const deadline = t0 + minutes * 60_000;
      const SHOT_INTERVAL_MS = 60_000;
      let nextShotMinute = 1;
      let lastLogLen = 0;
      let lastSettleShot = null;
      let lastSettleAt = t0;

      for (;;) {
        const now = Date.now();
        const elapsed = now - t0;

        // Drain the gap-free progress log -- never polls live DOM state.
        const fullLog = await page.evaluate(() => window.__progressLog);
        if (fullLog.length > lastLogLen) {
          for (const entry of fullLog.slice(lastLogLen)) {
            const atMs = entry.t - t0;
            result.progressLog.push({
              atMs,
              visible: entry.visible,
              text: entry.text,
            });
            console.error(
              `[surface-4d] ${scene.name}/${armLabel} progress @${atMs}ms: visible=${entry.visible} text=${JSON.stringify(entry.text)}`,
            );
          }
          lastLogLen = fullLog.length;
        }

        const newConsole = consoleMessages.slice(consoleBaseIdx);
        if (
          !result.computeActiveSeen &&
          newConsole.some((m) =>
            m.text.includes("WebGPU compute tracer active"),
          )
        ) {
          result.computeActiveSeen = true;
        }
        for (const m of newConsole) {
          if (
            m.text.startsWith("Surface compute preview") &&
            !result.previewLines.includes(m.text)
          ) {
            result.previewLines.push(m.text);
          }
          if (
            m.text.startsWith("Surface compute settle") &&
            !result.settleLines.includes(m.text)
          ) {
            result.settleLines.push(m.text);
          }
        }

        const minuteMark = Math.floor(elapsed / SHOT_INTERVAL_MS);
        if (minuteMark >= nextShotMinute) {
          const name = `${scene.name}-${armLabel}-${nextShotMinute * 60}s.png`;
          const buf = await canvasShot(name);
          result.screenshots.push({ atMs: elapsed, name, buf });
          console.error(
            `[surface-4d] ${scene.name}/${armLabel}: screenshot ${name} @${elapsed}ms`,
          );
          nextShotMinute++;
        }

        // Settle check, same definition as pollUntilSettled, coarse
        // cadence: "currently visible" comes from the LAST log entry, not
        // a fresh DOM read -- one fewer place this could race.
        const currentlyVisible = result.progressLog.at(-1)?.visible ?? false;
        if (now - lastSettleAt >= SETTLE_CHECK_INTERVAL_MS) {
          const shot = await canvasShot(null);
          if (
            lastSettleShot &&
            shot.equals(lastSettleShot) &&
            !currentlyVisible
          ) {
            result.settled = true;
            result.settleAtMs = elapsed;
            break;
          }
          lastSettleShot = shot;
          lastSettleAt = now;
        }

        if (now > deadline) break;
        await page.waitForTimeout(2_000);
      }

      const finalName = `${scene.name}-${armLabel}-final.png`;
      const finalBuf = await canvasShot(finalName);
      result.screenshots.push({
        atMs: Date.now() - t0,
        name: finalName,
        buf: finalBuf,
      });
      check(
        true,
        `${scene.name}/${armLabel}: observed ${minutes}min -- settled=${result.settled}${result.settled ? ` at ${result.settleAtMs}ms` : ""}`,
      );

      return result;
    }

    /** For each whole minute in [1, minutes], the last progress-log entry
     * observed at or before that mark -- the coordinator's requested
     * "last % at each minute" trajectory. */
    function minuteTrajectory(progressLog, minutes) {
      const rows = [];
      for (let m = 1; m <= minutes; m++) {
        const cutoff = m * 60_000;
        let last = null;
        for (const entry of progressLog) {
          if (entry.atMs <= cutoff) last = entry;
          else break;
        }
        rows.push({
          minute: m,
          atMs: last?.atMs ?? null,
          visible: last?.visible ?? null,
          text: last?.text ?? null,
        });
      }
      return rows;
    }

    /**
     * ROUTING-VERIFY mode (supersedes 916813c's shape-keyed
     * split): loads the PLAIN hash URL (no ?surfacegl, no stub — WebGPU
     * genuinely available) and asserts main.ts's routing lands this scene
     * on the engine EXPECT_COMPUTE_BY_SCENE says it should:
     *   expectCompute=true  -> "WebGPU compute tracer active" console
     *     line, a visible "· WebGPU" progress sample, settles.
     *   expectCompute=false -> NO compute-active line ever, every visible
     *     progress sample says "· WebGL" with NO trailing detail token
     *     (pins surfaceWebglDetail's null-before-checking-
     *     supported/block behavior). No scene currently sets
     *     expectCompute=false — the routing prefers compute for
     *     every 4D session with an adapter, so kaleidoscope 4D on WebGL
     *     is the measured-slower FALLBACK now, not the "measured home"
     *     916813c had made it — so this branch only runs if a future
     *     scene or routing change reintroduces a split; kept for that
     *     reason rather than deleted.
     * Reuses pollUntilSettled (the same settle definition every other
     * mode in this script uses: row hidden AND two canvas screenshots
     * >=1.5s apart byte-identical).
     */
    async function checkRouting(scene, expectCompute, budgetMs) {
      const url = `${BASE}/#${scene.hash}`;
      console.error(
        `[surface-4d] ==== ROUTING-VERIFY ${scene.name} (expect ${expectCompute ? "compute" : "WebGL"}): ${url} ====`,
      );
      const result = {
        scene: scene.name,
        expectCompute,
        computeActiveSeen: false,
        webgpuProgressSeen: false,
        webglProgressSeen: false,
        previewLines: [],
        progressSamples: [],
        settled: false,
        settleMs: null,
        screenshotPath: null,
      };
      const consoleBaseIdx = consoleMessages.length;
      const pageErrorsBefore = pageErrors.length;

      await gotoFresh(url, { waitUntil: "load", timeout: 30_000 });
      await waitForPointCount();
      await armContextLossTripwire();
      await page.waitForTimeout(1_000);

      const disabled = await page.$eval("#modeSurfaceBtn", (b) => b.disabled);
      check(!disabled, `${scene.name}: Surface mode control enabled`);
      if (disabled) return result;

      const t0 = Date.now();
      await page.click("#modeSurfaceBtn");

      const poll = await pollUntilSettled(
        result,
        t0,
        consoleBaseIdx,
        t0 + budgetMs,
      );
      result.settled = poll.settled;
      result.settleMs = poll.elapsedMs;

      check(
        result.settled,
        `${scene.name}: settled${result.settled ? ` in ${result.settleMs}ms` : ` -- FAILED to settle within ${budgetMs}ms`}`,
      );

      if (expectCompute) {
        check(
          result.computeActiveSeen,
          `${scene.name}: console shows "WebGPU compute tracer active"`,
        );
        check(
          result.webgpuProgressSeen,
          `${scene.name}: a visible progress sample says "· WebGPU"`,
        );
      } else {
        check(
          !result.computeActiveSeen,
          `${scene.name}: console NEVER claims "WebGPU compute tracer active"`,
        );
        const shownTexts = result.progressSamples.filter(
          (o) => o.visible && o.text,
        );
        if (shownTexts.length > 0) {
          check(
            shownTexts.every(
              (o) => o.text.includes("· WebGL") && !o.text.includes(" — "),
            ),
            `${scene.name}: every visible progress sample says "· WebGL" with NO detail token (${shownTexts.map((o) => o.text).join(" | ")})`,
          );
        } else {
          console.error(
            `[surface-4d] ${scene.name}: #surfaceProgress never observed visible (settled faster than the poll cadence) -- WebGL/no-token check not asserted.`,
          );
        }
      }

      const screenshotName = `${scene.name}-routing-verify.png`;
      await canvasShot(screenshotName);
      result.screenshotPath = screenshotName;

      const newPageErrors = pageErrors.slice(pageErrorsBefore);
      check(
        newPageErrors.length === 0,
        `${scene.name}: no page errors (${newPageErrors.join("|")})`,
      );

      return result;
    }

    /**
     * TUMBLE-PARK case 1, standalone and reusable: load the
     * scene fresh (gotoFresh), enter Surface, zero further input, assert
     * settled within budgetMs. This is the exact assertion that FAILED
     * before the fix (ambient tumble invalidated every frame, so the tier
     * scheduler never left preview and pollUntilSettled's byte-identity
     * check never had two stable frames to compare) — it must now pass on
     * BOTH the compute arm and the WebGL fragment arm.
     */
    async function caseOneSettle(scene, forceWebgl, label, budgetMs) {
      const url = forceWebgl
        ? `${BASE}/?surfacegl#${scene.hash}`
        : `${BASE}/#${scene.hash}`;
      console.error(
        `[surface-4d] ==== TUMBLE-PARK case1 ${label}: ${url} ====`,
      );
      const result = {
        label,
        computeActiveSeen: false,
        webgpuProgressSeen: false,
        webglProgressSeen: false,
        previewLines: [],
        progressSamples: [],
        settled: false,
        settleMs: null,
      };
      await gotoFresh(url, { waitUntil: "load", timeout: 30_000 });
      await waitForPointCount();
      await armContextLossTripwire();
      await page.waitForTimeout(1_000);

      const disabled = await page.$eval("#modeSurfaceBtn", (b) => b.disabled);
      check(!disabled, `case1 ${label}: Surface mode control enabled`);
      if (disabled) return result;

      const consoleBaseIdx = consoleMessages.length;
      const t0 = Date.now();
      await page.click("#modeSurfaceBtn");
      const poll = await pollUntilSettled(
        result,
        t0,
        consoleBaseIdx,
        t0 + budgetMs,
      );
      result.settled = poll.settled;
      result.settleMs = poll.elapsedMs;
      check(
        result.settled,
        `case1 ${label}: settled${result.settled ? ` in ${result.settleMs}ms (first-ever no-reducedMotion measurement)` : ` -- FAILED to settle within ${budgetMs}ms (tumble may still be invalidating frames)`}`,
      );
      const shownTexts = result.progressSamples.filter(
        (o) => o.visible && o.text,
      );
      if (shownTexts.length > 0) {
        console.error(
          `[surface-4d] case1 ${label}: progress row WAS observed visible (${shownTexts.length} sample(s)), e.g. ${JSON.stringify(shownTexts[0].text)}`,
        );
      } else {
        console.error(
          `[surface-4d] case1 ${label}: progress row never observed visible (settled faster than the poll cadence, or genuinely instant) -- "appears then hides" not directly confirmed, only the settle itself.`,
        );
      }
      await canvasShot(`${scene.name}-tumble-park-case1-${label}.png`);
      return result;
    }

    /**
     * TUMBLE-PARK cases 2-4, run on the ALREADY-SETTLED compute
     * session case1 leaves behind (same page, zero navigation): the
     * tumble-row hidden state in-mode, the resume-on-exit behavior
     * (rows reappear, checkbox state survives, the EXPLORER projection
     * genuinely tumbles again with zero input -- proving the park is
     * scoped to surface sessions, not a global disable), and the slice
     * slider's continued liveness after re-entering.
     */
    async function verifyTumbleParkCases234(scene) {
      const result = { case2: null, case3: null, case4: null };

      // ---- Case 2: tumble controls hidden while the surface session is live.
      const rowState = await page.evaluate(() => ({
        toggleRowHidden: document
          .getElementById("fourDTumbleToggleRow")
          ?.classList.contains("hidden"),
        speedRowHidden: document
          .getElementById("fourDTumbleRow")
          ?.classList.contains("hidden"),
      }));
      result.case2 = rowState;
      check(
        rowState.toggleRowHidden === true,
        `case2: #fourDTumbleToggleRow carries "hidden" while surface session is live`,
      );
      check(
        rowState.speedRowHidden === true,
        `case2: #fourDTumbleRow carries "hidden" while surface session is live`,
      );

      // ---- Case 3: resume on exit -- rows reappear, checkbox state
      // survives, and the EXPLORER projection genuinely tumbles again.
      const checkedBefore = await page.evaluate(
        () => document.getElementById("fourDTumbleToggle")?.checked,
      );
      await page.click("#modePointsBtn");
      await page.waitForTimeout(500);
      const afterExit = await page.evaluate(() => ({
        toggleRowHidden: document
          .getElementById("fourDTumbleToggleRow")
          ?.classList.contains("hidden"),
        checked: document.getElementById("fourDTumbleToggle")?.checked,
      }));
      check(
        afterExit.toggleRowHidden === false,
        `case3: #fourDTumbleToggleRow visible again after exiting to points mode`,
      );
      check(
        afterExit.checked === checkedBefore,
        `case3: tumble checkbox state preserved across the mode switch (was ${checkedBefore}, still ${afterExit.checked})`,
      );
      const shotA = await canvasShot(null);
      await page.waitForTimeout(1_000);
      const shotB = await canvasShot(
        `${scene.name}-tumble-park-case3-resumed.png`,
      );
      const resumeDiffPct = pngDiffPct(shotA, shotB);
      check(
        resumeDiffPct > PAINT_DIFF_PCT,
        `case3: explorer projection tumbles again with zero input (diff ${resumeDiffPct.toFixed(1)}% over 1s)`,
      );
      result.case3 = { checkedBefore, afterExit, resumeDiffPct };

      // ---- Case 4: re-enter Surface, wait settled, keyboard-drag the
      // slice slider, assert the canvas changes then re-settles (the
      // established liveness pattern from the normal per-scene protocol).
      const consoleBaseIdx4 = consoleMessages.length;
      const t0d = Date.now();
      await page.click("#modeSurfaceBtn");
      const enterResult = {
        computeActiveSeen: false,
        webgpuProgressSeen: false,
        webglProgressSeen: false,
        previewLines: [],
        progressSamples: [],
      };
      const enterPoll = await pollUntilSettled(
        enterResult,
        t0d,
        consoleBaseIdx4,
        t0d + TUMBLE_PARK_BUDGET_MS,
      );
      check(
        enterPoll.settled,
        `case4: re-entered Surface and settled${enterPoll.settled ? ` in ${enterPoll.elapsedMs}ms` : " -- FAILED to re-settle"}`,
      );
      if (!enterPoll.settled) {
        result.case4 = { reenterSettled: false };
        return result;
      }
      const settledShot = await canvasShot(null);

      const summary = page.locator("#fourDControls > summary");
      const isOpen = await page
        .locator("#fourDControls")
        .evaluate((el) => el.open);
      if (!isOpen) await summary.click();
      const slider = page.locator("#fourDSliceSlider");
      await slider.waitFor({ state: "visible", timeout: 10_000 });
      await slider.focus();
      const t0e = Date.now();
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("ArrowRight");
      }
      await page.waitForTimeout(300);
      const afterDrag = await canvasShot(
        `${scene.name}-tumble-park-case4-during.png`,
      );
      const dragDiffPct = pngDiffPct(settledShot, afterDrag);
      check(
        dragDiffPct > PAINT_DIFF_PCT,
        `case4: slice slider keyboard-drag changed the canvas (diff ${dragDiffPct.toFixed(1)}%)`,
      );

      const consoleBaseIdx5 = consoleMessages.length;
      const resettleResult = {
        computeActiveSeen: false,
        webgpuProgressSeen: false,
        webglProgressSeen: false,
        previewLines: [],
        progressSamples: [],
      };
      const resettlePoll = await pollUntilSettled(
        resettleResult,
        t0e,
        consoleBaseIdx5,
        t0e + TUMBLE_PARK_BUDGET_MS,
      );
      check(
        resettlePoll.settled,
        `case4: re-settled after slice drag${resettlePoll.settled ? ` in ${resettlePoll.elapsedMs}ms` : " -- FAILED"}`,
      );
      await canvasShot(`${scene.name}-tumble-park-case4-resettled.png`);
      result.case4 = {
        reenterSettleMs: enterPoll.elapsedMs,
        dragDiffPct,
        resettleMs: resettlePoll.settled ? resettlePoll.elapsedMs : null,
      };
      return result;
    }

    if (TUMBLE_PARK_MODE) {
      const scene = SCENES.find((s) => s.name === "plain4") ?? SCENES[0];
      console.error(
        `[surface-4d] ======== TUMBLE-PARK VERIFY (${scene.name}, reducedMotion NOT emulated) ========`,
      );
      const case1Compute = await caseOneSettle(
        scene,
        false,
        "compute",
        TUMBLE_PARK_BUDGET_MS,
      );
      let cases234 = null;
      if (case1Compute.settled) {
        cases234 = await verifyTumbleParkCases234(scene);
      } else {
        console.error(
          "[surface-4d] case1 compute did not settle -- skipping cases 2-4 (they depend on a settled compute session).",
        );
      }
      const case1Surfacegl = await caseOneSettle(
        scene,
        true,
        "surfacegl",
        TUMBLE_PARK_BUDGET_MS,
      );

      console.error("[surface-4d] ======== TUMBLE-PARK SUMMARY ========");
      console.error(
        `[surface-4d] case1 compute:   settled=${case1Compute.settled} settleMs=${case1Compute.settleMs}`,
      );
      console.error(
        `[surface-4d] case1 surfacegl: settled=${case1Surfacegl.settled} settleMs=${case1Surfacegl.settleMs}`,
      );
      if (cases234) {
        console.error(
          `[surface-4d] case2: toggleRowHidden=${cases234.case2.toggleRowHidden} speedRowHidden=${cases234.case2.speedRowHidden}`,
        );
        console.error(
          `[surface-4d] case3: checkedBefore=${cases234.case3.checkedBefore} afterExit=${JSON.stringify(cases234.case3.afterExit)} resumeDiffPct=${cases234.case3.resumeDiffPct.toFixed(1)}%`,
        );
        console.error(`[surface-4d] case4: ${JSON.stringify(cases234.case4)}`);
      }

      check(
        pageErrors.length === 0,
        `no page errors across the whole tumble-park run (${pageErrors.join(" | ")})`,
      );
      console.error("[surface-4d] ======== SUMMARY ========");
      console.error(
        `[surface-4d] VERDICT: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length}: ${failures.join("; ")})`}`,
      );
      process.exitCode = failures.length === 0 ? 0 : 1;
      return;
    }

    if (VERIFY_ROUTING_MODE) {
      const routingResults = [];
      for (const scene of SCENES) {
        const expectCompute = EXPECT_COMPUTE_BY_SCENE[scene.name];
        if (expectCompute === undefined) {
          console.error(
            `[surface-4d] ${scene.name}: no EXPECT_COMPUTE_BY_SCENE entry -- skipping (routing-verify only knows plain4/kaleido4).`,
          );
          continue;
        }
        routingResults.push(
          // Per-scene budget, not a flat routing-only constant: kaleido4's
          // own un-flagged session now measures a genuine compute settle
          // at 70.1s, which the OLD flat 60s
          // ROUTING_VERIFY_BUDGET_MS this file used to carry here could
          // not cover — scene.budgetMs already sizes for the scene's
          // worst arm (see KALEIDO4_ARM_BUDGET_MS above) and giving the
          // compute-only check here that same generous ceiling costs
          // nothing, since the poll returns the moment it settles.
          await checkRouting(scene, expectCompute, scene.budgetMs),
        );
      }

      console.error("[surface-4d] ======== ROUTING-VERIFY SUMMARY ========");
      for (const r of routingResults) {
        console.error(
          `[surface-4d] ${r.scene}: expectCompute=${r.expectCompute} computeActiveSeen=${r.computeActiveSeen} webgpuProgressSeen=${r.webgpuProgressSeen} webglProgressSeen=${r.webglProgressSeen} settled=${r.settled} settleMs=${r.settleMs}`,
        );
        const shown = r.progressSamples.filter((o) => o.visible && o.text);
        for (const o of shown) {
          console.error(
            `[surface-4d]   progress @${o.atMs}ms: ${JSON.stringify(o.text)}`,
          );
        }
      }

      check(
        pageErrors.length === 0,
        `no page errors across the whole routing-verify run (${pageErrors.join(" | ")})`,
      );
      console.error("[surface-4d] ======== SUMMARY ========");
      console.error(
        `[surface-4d] VERDICT: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length}: ${failures.join("; ")})`}`,
      );
      process.exitCode = failures.length === 0 ? 0 : 1;
      return;
    }

    if (OBSERVE_MODE) {
      const observeResults = [];
      for (const scene of SCENES) {
        if (ARM_SELECT === "compute" || ARM_SELECT === "both") {
          observeResults.push(
            await observeArm(scene, "compute", {
              forceWebgl: false,
              minutes: OBSERVE_MINUTES,
            }),
          );
        }
        if (ARM_SELECT === "surfacegl" || ARM_SELECT === "both") {
          observeResults.push(
            await observeArm(scene, "surfacegl", {
              forceWebgl: true,
              minutes: OBSERVE_MINUTES,
            }),
          );
        }
      }

      console.error("[surface-4d] ======== OBSERVE COMPARISON ========");
      for (const r of observeResults) {
        console.error(`[surface-4d] ---- ${r.scene}/${r.arm} ----`);
        if (r.aborted) {
          console.error(`[surface-4d]   aborted: ${r.abortReason}`);
          continue;
        }
        console.error(
          `[surface-4d]   settled=${r.settled}${r.settled ? ` @${r.settleAtMs}ms` : ""} computeActiveSeen=${r.computeActiveSeen}`,
        );
        for (const row of minuteTrajectory(r.progressLog, OBSERVE_MINUTES)) {
          console.error(
            `[surface-4d]   minute ${row.minute}: ${
              row.text === null
                ? "(no sample yet)"
                : `visible=${row.visible} ${JSON.stringify(row.text)} (last update @${row.atMs}ms)`
            }`,
          );
        }
        console.error(
          `[surface-4d]   previewLines=${r.previewLines.length} settleLines=${r.settleLines.length}`,
        );
        for (const line of r.previewLines.slice(0, 3)) {
          console.error(`[surface-4d]     preview: ${line}`);
        }
        for (const line of r.settleLines.slice(0, 3)) {
          console.error(`[surface-4d]     settle : ${line}`);
        }
        console.error(
          `[surface-4d]   screenshots: ${r.screenshots.map((s) => s.name).join(", ")}`,
        );
        for (let i = 1; i < r.screenshots.length; i++) {
          const diff = pngDiffPct(
            r.screenshots[i - 1].buf,
            r.screenshots[i].buf,
          );
          console.error(
            `[surface-4d]     ${r.screenshots[i - 1].name} -> ${r.screenshots[i].name}: diff ${diff.toFixed(2)}%`,
          );
        }
      }

      check(
        pageErrors.length === 0,
        `no page errors across the whole observe run (${pageErrors.join(" | ")})`,
      );
      console.error("[surface-4d] ======== SUMMARY ========");
      console.error(
        `[surface-4d] VERDICT: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length}: ${failures.join("; ")})`}`,
      );
      process.exitCode = failures.length === 0 ? 0 : 1;
      return;
    }

    for (const scene of SCENES) {
      const compute = await runArm(scene, "compute", { forceWebgl: false });
      if (compute.aborted) {
        console.error(
          `[surface-4d] ${scene.name}: compute arm aborted (${compute.abortReason}) -- skipping liveness/fallback/parity for this scene per the task brief.`,
        );
        continue;
      }

      // The liveness leg pins the COMPUTE arm's per-frame view4 re-read
      // (the ifs4 live-uniform discipline across the WebGPU seam) against
      // whichever engine `runArm(scene, "compute", ...)` actually lands
      // on. BEFORE the width fix that was not always the compute engine its
      // label claimed: kaleido4's order-6 kaleidoscope shape-routed the
      // un-flagged arm to the FRAGMENT tracer, so this leg was re-testing
      // the long-proven WebGL live-uniform path at order-6 cost instead
      // (measured 2026-08-10: the post-drag re-settle blew the 90s poll
      // window at 95.6s). The post-drag diagnosis (2026-08-11,
      // --force-liveness + ?surfperf evidence logging): NOT the
      // over-stripping residual this comment first suspected — the
      // evidence chain stayed clean (partial=0 throughout, strips
      // averaged ~67ms against the 75ms target) and the cost was
      // POSE-INTRINSIC to THAT (fragment) arm: kaleido4's w=0 slice was
      // uniquely cheap there, and an off-center slice cost ~20-40x more
      // per pixel on it (one 0.01 slider step: preview 0.0041 -> 0.0795
      // ms/px, settle 2.1s -> 60.9s GPU; a FRESH session jumped straight
      // to the 30-step pose measured the same class: 0.0736 ms/px, 42.3s
      // settle — `scripts/slice-cliff.probe.mjs` has the numbers). A
      // re-settle after any slice drag was an honest minute-plus grind at
      // order 6 on the fragment arm, so the leg was skipped wherever
      // routing said fragment unless --force-liveness asked. SINCE THE
      // ROUTING CHANGE: routing never sends an un-flagged arm to the
      // fragment tracer any more (see EXPECT_COMPUTE_BY_SCENE above), so
      // `runArm(scene, "compute", ...)` means what its label always
      // claimed for every scene including kaleido4, this leg always pins
      // the GENUINE compute engine's view4 re-read, and the skip below
      // never fires in practice — it stays, harmlessly, for the same
      // forward-compatibility reason FORCE_LIVENESS itself does.
      if (FORCE_LIVENESS || (EXPECT_COMPUTE_BY_SCENE[scene.name] ?? true)) {
        if (FORCE_LIVENESS && !(EXPECT_COMPUTE_BY_SCENE[scene.name] ?? true)) {
          console.error(
            `[surface-4d] ${scene.name}: liveness leg FORCED on a fragment-routed scene (--force-liveness, the post-drag re-settle repro).`,
          );
        }
        await testLiveness(scene, compute.settledShotBuf);
      } else {
        console.error(
          `[surface-4d] ${scene.name}: fragment-routed scene -- liveness leg (a compute-arm view4 re-read pin) skipped.`,
        );
      }

      const fallback = await runArm(scene, "surfacegl", { forceWebgl: true });
      if (fallback.refused) {
        console.error(
          `[surface-4d] ${scene.name}: ?surfacegl arm refused as expected (fold-4D has no fragment arm) -- no parity to compute.`,
        );
        continue;
      }
      if (fallback.aborted) {
        console.error(
          `[surface-4d] ${scene.name}: fallback arm aborted (${fallback.abortReason}) -- skipping parity for this scene.`,
        );
        continue;
      }

      const iou = await computeIoU(
        compute.settledShotBuf,
        fallback.settledShotBuf,
      );
      if (iou.error) {
        check(false, `${scene.name}: IoU could not be computed (${iou.error})`);
      } else {
        const verdict =
          iou.iou >= 0.8 ? "OK" : iou.iou >= 0.5 ? "WARN" : "FAIL";
        console.error(
          `[surface-4d] ${scene.name}: IoU ${iou.iou.toFixed(3)} (${verdict}) -- ` +
            `compute object px=${iou.countA}, surfacegl object px=${iou.countB}, ` +
            `intersection=${iou.intersection}, union=${iou.union}, ${iou.width}x${iou.height}`,
        );
        if (verdict === "FAIL") {
          check(false, `${scene.name}: IoU ${iou.iou.toFixed(3)} < 0.5`);
        } else {
          check(true, `${scene.name}: IoU ${iou.iou.toFixed(3)} (${verdict})`);
        }
        iouResults.push({ scene: scene.name, ...iou, verdict });
      }
    }

    console.error("[surface-4d] ======== ARM SUMMARY ========");
    for (const r of armResults) {
      console.error(
        `[surface-4d] ${r.scene}/${r.arm}: aborted=${r.aborted}${r.aborted ? ` (${r.abortReason})` : ""} settled=${r.settled} settleMs=${r.settleMs} computeActiveSeen=${r.computeActiveSeen} webgpuProgressSeen=${r.webgpuProgressSeen} webglProgressSeen=${r.webglProgressSeen} previewLines=${r.previewLines.length}`,
      );
      if (r.previewLines.length > 0) {
        console.error(
          `[surface-4d]   preview line sample: ${r.previewLines[0]}${r.previewLines.length > 1 ? ` (+${r.previewLines.length - 1} more)` : ""}`,
        );
      }
    }
    console.error("[surface-4d] ======== IoU SUMMARY ========");
    for (const r of iouResults) {
      console.error(
        `[surface-4d] ${r.scene}: IoU=${r.iou.toFixed(3)} (${r.verdict})`,
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
      console.error(`[surface-4d] final context-lost tripwire: ${lost}`);
    }
    if (pageErrors.length) {
      console.error(`[surface-4d] page errors: ${pageErrors.join(" | ")}`);
    }
    await browser.close();
  }
  console.error("[surface-4d] ======== SUMMARY ========");
  console.error(
    `[surface-4d] VERDICT: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length}: ${failures.join("; ")})`}`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("[surface-4d] fatal:", err);
  process.exitCode = 1;
});
