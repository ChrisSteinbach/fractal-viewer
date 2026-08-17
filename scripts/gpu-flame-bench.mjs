#!/usr/bin/env node
/**
 * fr-npb: headless runner for the GPU-flame agreement/benchmark page
 * (src/app/gpu-bench/index.html) — the standing check that pins the
 * production WebGPU kernel (src/fractal/flame-gpu.ts) to accumulateFlame,
 * its CPU oracle. Drives the page in real Chrome via playwright-core (WebGPU
 * needs an actual browser — jsdom/Vitest can't run it), waits for the page
 * to finish every scenario, and dumps its JSON results + screenshots.
 * Ported from fr-53k's spike runner (`git show
 * spike/fr-53k-gpu-flame-accum:scripts/gpu-flame-bench.mjs`); CI-able via
 * this script's own exit code (see the `agreement` check below), which the
 * spike's throwaway version had no need for.
 *
 * Usage:
 *   node scripts/gpu-flame-bench.mjs [--duration=4] [--scenarios=a,b]
 *                                     [--shard=i/n]
 *     [--url=https://host:port] [--headed] [--chrome=/path/to/chrome]
 *     [--swiftshader] [--out=bench-results]
 *     [--surface | --surface-only] [--display=:0]
 *     [--surface-widths=12,4] [--surface-timing-widths=12,8,6,4]
 *     [--surface-variants=shared,private] [--surface-wg=32]
 *     [--surface-size=320x180] [--surface-cap-ms=120000]
 *     [--surface-systems=all|synthetic] [--surface-timing=0|1]
 *     [--surface-force=1] [--surface-shade-width=1,4]
 *     [--surface-aff4-sweep=1] [--surface-plane-frame=1]
 *     [--surface-canary-trip=N]
 *
 * fr-q1f8: `--surface` runs the page's surface-DE kernel section AFTER the
 * flame scenarios (`?surface=1`); `--surface-only` runs it INSTEAD of them
 * (`?surface=only`). The `--surface-*` passthrough flags map 1:1 onto the
 * page's URL params (see `parseSurfaceConfig` in src/app/gpu-bench/main.ts
 * for defaults/semantics). With either flag the exit code additionally
 * gates on `results.surfaceDe.verdict` (1 on "fail", 2 on "skipped" or
 * "device-unreliable" — rerun on a quiet machine); the flame agreement gate
 * below applies exactly as before, but only when the flame scenarios
 * actually ran (i.e. not under --surface-only). Without any surface flag,
 * behavior is bit-for-bit unchanged — CI unaffected.
 *
 * `--display=<d>` launches HEADED Chrome against a real X display (the
 * fold-width-sweep.mjs x11 recipe: DISPLAY in the env, no --headless=new,
 * --no-sandbox) so the WebGPU adapter is the real driver instead of
 * SwiftShader — the mode the surface timing sweep is meant to run in. The
 * WebGL --use-gl/--use-angle flags are deliberately NOT added: WebGPU goes
 * through Vulkan independently of ANGLE.
 *
 * `--chrome=bundled` launches the Playwright-BUNDLED Chromium (the same
 * hermetic browser the WebGL smoke test uses) instead of a system Chrome —
 * the right choice on CI, where /usr/bin/google-chrome may not exist and the
 * bundled chrome-linux64 is the build known to ship libvk_swiftshader.so.
 * `--swiftshader` forces the WebGPU adapter onto SwiftShader (Chrome's
 * bundled software Vulkan), so a GPU-less runner still executes the REAL
 * WGSL kernels — slowly, but bit-faithfully — instead of skipping the
 * agreement check. Together they are the CI invocation (see the
 * gpu-agreement workflow, .github/workflows/gpu-agreement.yml — its own
 * file since fr-hzlm, so a fail-safe paths-ignore can skip the ~18min
 * sweep on changes that are entirely docs).
 *
 * Without --url, this spawns `npm run dev` itself and tears it down when
 * done (including on error) — the whole point being a one-shot
 * `node scripts/gpu-flame-bench.mjs` with no other setup.
 *
 * Exit code is non-zero when either the page reported a fatal error
 * (`__BENCH_ERROR__`) or the agreement check itself failed
 * (`__BENCH_RESULTS__.agreement === "fail"`) — the second is what makes this
 * script meaningful in CI: a passing exit code means the shipped kernel's
 * output statistically agrees with the CPU oracle on every scenario that ran.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/** Vite's conventional default port — used only as a last-resort fallback if
 * spawnDevServer's own stdout-announced port is somehow never seen (see its
 * doc); the normal case uses whatever port Vite actually reports. */
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_TIMEOUT_MS = 60_000;
/**
 * Wait cap for the flame sweep — a HANG detector, not a budget: the run
 * polls for `__BENCH_DONE__` and exits the moment it lands, so a cap set
 * generously costs nothing on a healthy run and only avoids reporting a slow
 * host as a failure. Raised from 10 to 20 minutes by fr-hiyu, which added a
 * fourteenth scenario (`xform-color`): each scenario's fixed equal-N legs are
 * ~50.3M iterations PER SIDE, which SwiftShader measured at ~45-50s apiece on
 * a busy dev box — so thirteen already sat against the old 10-minute wall and
 * the fourteenth crossed it, failing a sweep whose every scenario agreed.
 */
const BENCH_TIMEOUT_MS = 20 * 60_000;
/** Wait cap when a surface flag is present — the surface timing matrix
 * (many kernel configs, multi-pass marches, a per-config wall cap of its
 * own) can legitimately run far past the flame sweep's own wait. */
const SURFACE_BENCH_TIMEOUT_MS = 30 * 60_000;
/** Wait cap when the fr-p8bc shade A/B leg is requested on top: its
 * full-width BASELINE arms are the whole point of the comparison and
 * measured up to ~10-15 minutes EACH on Iris (two poses), on top of leg
 * B's own budget — a 30-minute ceiling measured a timeout mid-leg. */
const SURFACE_SHADE_AB_TIMEOUT_MS = 60 * 60_000;
const DEFAULT_CHROME = "/usr/bin/google-chrome";

/** `--surface-*` passthrough flags → the page's URL params (defaults and
 * semantics live in src/app/gpu-bench/main.ts's parseSurfaceConfig). */
const SURFACE_PASSTHROUGH_FLAGS = {
  "surface-widths": "surfaceWidths",
  "surface-timing-widths": "surfaceTimingWidths",
  "surface-variants": "surfaceVariants",
  "surface-size": "surfaceSize",
  "surface-cap-ms": "surfaceCapMs",
  "surface-systems": "surfaceSystems",
  "surface-timing": "surfaceTiming",
  "surface-wg": "surfaceWg",
  "surface-force": "surfaceForce",
  // fr-p8bc shade A/B leg: comma list of cheap shade-probe widths to
  // measure against the shipped full-width baseline (e.g. "1,4"); absent =
  // the leg is skipped (see parseSurfaceConfig's doc).
  "surface-shade-width": "surfaceShadeWidth",
  // fr-b72d opt-in leg: "1" times the affine4 eval kernel per
  // kaleidoscope order (1,2,3,4,6), slab vs no-slab; absent/anything else
  // = the leg is skipped (see runSurfaceAff4SweepLeg's doc in main.ts).
  "surface-aff4-sweep": "surfaceAff4Sweep",
  // fr-qjae opt-in leg: "1" renders one extra end-to-end frame through a
  // fr-rhn5 groundPlane:true kernel and checks it against a strided CPU
  // sanity march in hit- AND plane-rate terms; absent/anything else = the
  // leg is skipped (see runSurfaceComputeFramePlaneLeg's doc in main.ts).
  // Deliberately NOT in the `surfaceHeavyLeg` timeout list below: it is one
  // cheap affine frame, and listing it there would claim a cost it does not
  // have.
  "surface-plane-frame": "surfacePlaneFrame",
  // fr-76pp: synthetic device-sanity trip at the Nth canary check — a
  // rehearsal of the "device-unreliable" verdict path; absent = the canary
  // runs for real (see createSurfaceCanary's doc in main.ts).
  "surface-canary-trip": "surfaceCanaryTrip",
};

function parseArgs(argv) {
  const args = {
    duration: "4",
    scenarios: undefined,
    shard: undefined,
    url: undefined,
    headed: false,
    chrome: DEFAULT_CHROME,
    swiftshader: false,
    out: "bench-results",
    surface: false,
    surfaceOnly: false,
    display: undefined,
    surfaceParams: {},
  };
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      throw new Error(
        `Unrecognized argument: ${raw} (flags must start with --)`,
      );
    }
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    switch (key) {
      case "duration":
        args.duration = value;
        break;
      case "scenarios":
        args.scenarios = value;
        break;
      case "shard":
        args.shard = value;
        break;
      case "url":
        args.url = value.replace(/\/+$/, "");
        break;
      case "headed":
        args.headed = true;
        break;
      case "chrome":
        args.chrome = value;
        break;
      case "swiftshader":
        args.swiftshader = true;
        break;
      case "out":
        args.out = value;
        break;
      case "surface":
        args.surface = true;
        break;
      case "surface-only":
        args.surfaceOnly = true;
        break;
      case "display":
        args.display = value;
        break;
      default:
        if (key in SURFACE_PASSTHROUGH_FLAGS) {
          args.surfaceParams[SURFACE_PASSTHROUGH_FLAGS[key]] = value;
          break;
        }
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  return args;
}

/** One `unproj`/`unproj-lens` row (fr-tzdg leg A / fr-55s1 stage C),
 * formatted for stdout — shared by both legs in printSurfaceSummary below,
 * which differ only in which system built and which label prefixes the
 * line. */
function formatSurfaceUnprojectRow(label, row) {
  return (
    `  ${label} ${row.system} w${row.width} wg${row.wg} ${row.rasterWidth}x${row.rasterHeight}: ` +
    `rays=${row.rays} statusMm=${row.statusMismatches} boundary=${row.boundaryFlips} ` +
    `silhouette=${row.silhouetteFlips} ` +
    `graze=${row.hitTGrazes} hitTFail=${row.hitTFailures} ` +
    `maxAbsT=${row.maxAbsT.toExponential(2)} ` +
    `fail=${row.failures} hits=${row.gpuHits}/${row.cpuHits}(gpu/cpu) ` +
    `gpu=${row.gpuMs.toFixed(0)}ms passes=${row.passes}` +
    (row.truncated ? " TRUNCATED" : "")
  );
}

/** One line per agreement row and per timing config — the compact stdout
 * view of results.surfaceDe (the full JSON still lands in results.json). */
function printSurfaceSummary(surfaceDe) {
  if (!surfaceDe) {
    console.log("surfaceDe: (no results — section never published)");
    return;
  }
  const reason = surfaceDe.reason ? ` reason="${surfaceDe.reason}"` : "";
  console.log(`surfaceDe: verdict=${surfaceDe.verdict}${reason}`);
  // fr-76pp: device-sanity canary state, printed as early as possible — a
  // TRIPPED canary means every row below is suspect, not kernel evidence.
  const ds = surfaceDe.deviceSanity;
  if (ds) {
    if (ds.trippedAt) {
      console.log(
        `  deviceSanity: checks=${ds.checks} n=${ds.n} TRIPPED after ${ds.trippedAt}: ${ds.detail}`,
      );
    } else {
      console.log(`  deviceSanity: checks=${ds.checks} n=${ds.n}`);
    }
  }
  for (const r of surfaceDe.agreement ?? []) {
    const cls = r.failuresByClass;
    const failureDetail =
      r.failures > 0 && cls
        ? ` over=${r.failuresOver} cls=j${cls.jittered}/u${cls.uniform}/e${cls.exact}`
        : "";
    // Non-gating rows (width ≠ the CPU oracle's fixed frontier width)
    // measure expected narrow-width erosion — labeled so a nonzero
    // "fail=" count there is not misread as kernel disagreement.
    const tag = r.gating === false ? "info " : "agree";
    // fr-dlxh escape rows: the marginal-orbit exclusion count and any
    // verified chaotic flips must be VISIBLE (a silently shrinking
    // stable set would read as clean).
    const excluded =
      (r.excluded !== undefined ? ` excluded=${r.excluded}` : "") +
      (r.chaoticFlips ? ` flips=${r.chaoticFlips}` : "");
    console.log(
      `  ${tag} ${r.system} ${r.variant} w${r.width} s2=${r.stage2 ? "on" : "off"} wg${r.wg}: ` +
        `n=${r.n} fail=${r.failures} maxAbs=${r.maxAbsErr.toExponential(2)} ` +
        `maxRel=${r.maxRelErr.toExponential(2)} p99Abs=${r.p99AbsErr.toExponential(2)} ` +
        `signed=[${r.minGpuMinusCpu.toExponential(2)}, ${r.maxGpuMinusCpu.toExponential(2)}]` +
        excluded +
        failureDetail,
    );
  }
  for (const c of surfaceDe.crossChecks ?? []) {
    console.log(
      `  cross ${c.kind} ${c.system} w${c.width}: mismatches=${c.mismatches} ` +
        `maxDelta=${c.maxDelta.toExponential(2)} (${c.note})`,
    );
  }
  for (const t of surfaceDe.timing ?? []) {
    const truncated = t.truncated
      ? ` TRUNCATED active=${t.activeRemaining}` +
        (t.completedFraction !== undefined
          ? ` done=${(t.completedFraction * 100).toFixed(1)}%`
          : "") +
        (t.extrapolatedMs !== undefined
          ? ` extrapolated≈${t.extrapolatedMs.toFixed(0)}ms`
          : "")
      : "";
    console.log(
      `  time ${t.variant} w${t.width} s2=${t.stage2 ? "on" : "off"} wg${t.wg}: ` +
        `compile=${t.compileMs.toFixed(0)}ms gpu=${t.gpuMs.toFixed(0)}ms ` +
        `wall=${t.wallMs.toFixed(0)}ms passes=${t.passes} hits=${t.hits} ` +
        `miss=${t.miss} exh=${t.exhausted} meanSteps=${t.meanSteps.toFixed(1)}` +
        (t.sanity ? ` sanity=${t.sanity}` : "") +
        truncated,
    );
  }
  // fr-tzdg leg A: the march-unproject agreement gate (app ray path).
  const mu = surfaceDe.marchUnproject;
  if (mu) {
    if (mu.skipped) {
      console.log(`  unproj: skipped — ${mu.skipped}`);
    } else {
      console.log(formatSurfaceUnprojectRow("unproj", mu));
    }
  }
  // fr-55s1 stage C: leg A over the lens field class.
  const mul = surfaceDe.marchUnprojectLens;
  if (mul) {
    if (mul.skipped) {
      console.log(`  unproj-lens: skipped — ${mul.skipped}`);
    } else {
      console.log(formatSurfaceUnprojectRow("unproj-lens", mul));
    }
  }
  // fr-5wlv.5: leg A through the balloon inverted-union wrapper.
  const mub = surfaceDe.marchUnprojectBalloon;
  if (mub) {
    if (mub.skipped) {
      console.log(`  unproj-balloon: skipped — ${mub.skipped}`);
    } else {
      console.log(formatSurfaceUnprojectRow("unproj-balloon", mub));
    }
  }
  // fr-tzdg leg B: the end-to-end SurfaceComputeRenderer frame.
  const cf = surfaceDe.computeFrame;
  if (cf) {
    if (cf.skipped) {
      console.log(`  frame: skipped — ${cf.skipped}`);
    } else {
      console.log(
        `  frame ${cf.width}x${cf.height}: wall=${cf.wallMs.toFixed(0)}ms ` +
          `gpu=${cf.gpuMs.toFixed(0)}ms passes=${cf.passes} ` +
          `hit=${cf.counts.hit} miss=${cf.counts.miss} exh=${cf.counts.exhausted} ` +
          `active=${cf.counts.active}${cf.truncated ? " TRUNCATED" : ""}`,
      );
    }
  }
  // fr-55s1 stage C: leg B over the lens field class (production
  // SurfaceComputeRenderer on lensMandelboxOverAffine).
  const cfl = surfaceDe.computeFrameLens;
  if (cfl) {
    if (cfl.skipped) {
      console.log(`  frame-lens: skipped — ${cfl.skipped}`);
    } else {
      console.log(
        `  frame-lens ${cfl.width}x${cfl.height}: wall=${cfl.wallMs.toFixed(0)}ms ` +
          `gpu=${cfl.gpuMs.toFixed(0)}ms passes=${cfl.passes} ` +
          `hit=${cfl.counts.hit} miss=${cfl.counts.miss} exh=${cfl.counts.exhausted} ` +
          `active=${cfl.counts.active}${cfl.truncated ? " TRUNCATED" : ""}`,
      );
    }
  }
  // fr-dlxh: leg B over the escape class (production renderer on
  // escMandelbox, forward-orbit core) + its CPU sanity-march rate band.
  const cfe = surfaceDe.computeFrameEscape;
  if (cfe) {
    if (cfe.skipped) {
      console.log(`  frame-escape: skipped — ${cfe.skipped}`);
    } else {
      const sanity =
        cfe.sanityGpuHitRate !== undefined
          ? ` rate gpu=${cfe.sanityGpuHitRate.toFixed(3)} cpu=${(cfe.sanityCpuHitRate ?? 0).toFixed(3)}`
          : "";
      console.log(
        `  frame-escape ${cfe.width}x${cfe.height}: wall=${cfe.wallMs.toFixed(0)}ms ` +
          `gpu=${cfe.gpuMs.toFixed(0)}ms passes=${cfe.passes} ` +
          `hit=${cfe.counts.hit} miss=${cfe.counts.miss} exh=${cfe.counts.exhausted} ` +
          `active=${cfe.counts.active}${sanity}${cfe.truncated ? " TRUNCATED" : ""}`,
      );
    }
  }
  // fr-p8bc shade A/B leg: cheap shading-probe-width vs the shipped
  // full-width baseline — informational, never gates surfaceDe.verdict.
  for (const r of surfaceDe.shadeAb ?? []) {
    const ratio =
      r.cheap.shadeMs > 0 ? r.baseline.shadeMs / r.cheap.shadeMs : Infinity;
    const flags =
      (r.hitMismatch ? " HIT MISMATCH" : "") +
      (r.suspect ? ` SUSPECT(${r.reason ?? "?"})` : "");
    console.log(
      `  shade-ab ${r.pose} w${r.probeWidth}: shade ${r.baseline.shadeMs.toFixed(0)}ms -> ` +
        `${r.cheap.shadeMs.toFixed(0)}ms (${ratio.toFixed(1)}x), ` +
        `march ${r.baseline.marchMs.toFixed(0)}ms/${r.cheap.marchMs.toFixed(0)}ms, ` +
        `diff ${r.diff.pctPixelsOver8.toFixed(1)}% px >8, mean ${r.diff.meanAbsDeltaDiffPixels.toFixed(1)} ` +
        `max ${r.diff.maxAbsDelta}, hits ${r.baseline.counts.hit}/${r.cheap.counts.hit}${flags}`,
    );
  }
  for (const note of surfaceDe.notes ?? []) {
    console.log(`  note: ${note}`);
  }
}

/** Poll `url` (ignoring the dev server's self-signed cert) until it responds
 * with any HTTP status, or throw after `timeoutMs`. */
function pollUntilUp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = https.get(
        url,
        { rejectUnauthorized: false, timeout: 5_000 },
        (res) => {
          res.resume(); // drain and discard — we only care that something answered.
          resolve();
        },
      );
      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(
            new Error(
              `Timed out waiting for ${url} to respond after ${timeoutMs}ms`,
            ),
          );
          return;
        }
        setTimeout(attempt, 500);
      });
      req.on("timeout", () => req.destroy());
    }
    attempt();
  });
}

/** Vite's own "Local: https://host:PORT/" announcement — parsed out of its
 * stdout so this script talks to whatever port Vite ACTUALLY bound, not a
 * hardcoded guess. Matters because `npm run dev` auto-increments past 5173
 * when something else already holds it (observed in the wild: a stray dev
 * server left running from an unrelated earlier session) — polling a fixed
 * port would then silently succeed against THAT other server instead of the
 * one this script just spawned, which is exactly the kind of "looks fine,
 * measures the wrong thing" failure a benchmark script must not have. */
const VITE_LOCAL_URL_RE = /Local:\s+https?:\/\/[^/\s]+:(\d+)/;

/** Spawn `npm run dev` in its own process group (so `killDevServer` can take
 * down Vite's own child processes too, not just the `npm` wrapper). Returns
 * the child plus a promise for the port Vite reports listening on. */
function spawnDevServer() {
  const child = spawn("npm", ["run", "dev"], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let resolvePort;
  const portPromise = new Promise((resolve) => {
    resolvePort = resolve;
  });
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(`[dev-server] ${text}`);
    const match = VITE_LOCAL_URL_RE.exec(text);
    if (match) resolvePort(Number(match[1]));
  });
  child.stderr.on("data", (chunk) =>
    process.stderr.write(`[dev-server] ${chunk}`),
  );
  return { child, portPromise };
}

function killDevServer(child) {
  if (!child || child.killed || child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone — nothing to do.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A screenshot that must never fail the run — used for the timing-based
 * mid-run progress captures, which have no page hook to synchronize on and
 * can legitimately race page state (e.g. a scenario finishing early). */
async function screenshotBestEffort(page, filePath) {
  try {
    await page.screenshot({ path: filePath, fullPage: true });
    console.error(
      `[gpu-flame-bench] progress screenshot written to ${filePath}`,
    );
  } catch (err) {
    console.error(
      `[gpu-flame-bench] progress screenshot to ${filePath} failed (ignored): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const surfaceRequested = args.surface || args.surfaceOnly;
  // fr-b72d's opt-in sweep leg is the same shape as fr-p8bc's shade A/B
  // leg for this purpose — an extra heavy pass layered on top of the
  // standard surface section, capable of running long on a real driver
  // (the sweep's own point is to measure the slow end of the affine4
  // kernel's cost curve) — so it earns the same wider wait cap.
  const surfaceHeavyLeg =
    args.surfaceParams.surfaceShadeWidth || args.surfaceParams.surfaceAff4Sweep;
  const benchTimeoutMs = surfaceRequested
    ? surfaceHeavyLeg
      ? SURFACE_SHADE_AB_TIMEOUT_MS
      : SURFACE_BENCH_TIMEOUT_MS
    : BENCH_TIMEOUT_MS;
  const outDir = path.resolve(REPO_ROOT, args.out);
  await mkdir(outDir, { recursive: true });

  let devServer = null;
  let base = args.url;
  if (!base) {
    console.error(
      "[gpu-flame-bench] no --url given; spawning `npm run dev`...",
    );
    const spawned = spawnDevServer();
    devServer = spawned.child;
    // Prefer the port Vite actually announces (see spawnDevServer's doc);
    // fall back to the conventional default only if that announcement is
    // somehow never seen within the startup timeout.
    const announcedPort = await Promise.race([
      spawned.portPromise,
      new Promise((resolve) =>
        setTimeout(() => resolve(null), DEV_SERVER_TIMEOUT_MS),
      ),
    ]);
    base = `https://localhost:${announcedPort ?? DEV_SERVER_PORT}`;
    try {
      await pollUntilUp(`${base}/gpu-bench/index.html`, DEV_SERVER_TIMEOUT_MS);
    } catch (err) {
      killDevServer(devServer);
      throw err;
    }
    console.error(`[gpu-flame-bench] dev server responding at ${base}`);
  } else {
    console.error(`[gpu-flame-bench] using existing server at ${base}`);
  }

  let browser = null;
  let exitCode = 0;
  try {
    // `--chrome=bundled` resolves to the Playwright-bundled Chromium — same
    // hermetic-browser convention as scripts/webgl-smoke.mjs (see this
    // script's usage doc for when that matters).
    const executablePath =
      args.chrome === "bundled" ? chromium.executablePath() : args.chrome;
    // `--display` wins over `--headed`: it launches HEADED on that X
    // display (below), so reporting `headless=true` there — as this line
    // did — contradicts the run it is announcing, on exactly the
    // real-driver runs the surface section insists on.
    console.error(
      `[gpu-flame-bench] launching ${executablePath} (${
        args.display !== undefined
          ? `headed on DISPLAY=${args.display}`
          : args.headed
            ? "headed"
            : "headless=new"
      })`,
    );
    // Playwright's `headless: true` launches Chrome's OLD headless mode,
    // which has no GPU stack at all — navigator.gpu never exists there, so
    // the agreement check could only ever report "skipped" (fr-2w5; same
    // trap scripts/webgl-smoke.mjs documents). NEW headless mode must be
    // requested explicitly: `headless: false` stops Playwright injecting
    // the old flag, and `--headless=new` opts into the mode that keeps the
    // GPU process.
    const launchFlags = [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
    ];
    if (args.swiftshader) {
      // Force BOTH knobs onto SwiftShader: `--use-webgpu-adapter` pins
      // Dawn's adapter selection, and `--use-vulkan=swiftshader` points the
      // Vulkan feature (enabled above) at the bundled software ICD instead
      // of probing for real hardware a CI box doesn't have.
      launchFlags.push(
        "--use-webgpu-adapter=swiftshader",
        "--use-vulkan=swiftshader",
      );
    }
    if (args.display !== undefined) {
      // Real-driver mode (the fold-width-sweep.mjs x11 recipe): headed
      // against the given X display, --no-sandbox, and NO --headless=new.
      // The three WebGPU flags above stay as-is — WebGPU reaches the real
      // GPU through Vulkan, independent of the ANGLE/WebGL flags the WebGL
      // sweeps need.
      launchFlags.push("--no-sandbox");
    } else if (!args.headed) {
      launchFlags.push("--headless=new");
    }
    browser = await chromium.launch({
      executablePath,
      headless: false,
      args: launchFlags,
      ...(args.display !== undefined
        ? { env: { ...process.env, DISPLAY: args.display } }
        : {}),
    });
    // Wide enough that a scenario's three 960px canvases sit un-clipped in
    // one row — page.png would otherwise cut off the GPU/diff canvases.
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 3040, height: 1000 },
    });
    page.on("console", (msg) => {
      process.stderr.write(`[page:${msg.type()}] ${msg.text()}\n`);
    });
    page.on("pageerror", (err) => {
      process.stderr.write(`[page:uncaught] ${err.stack ?? err.message}\n`);
    });

    const query = new URLSearchParams({
      autorun: "1",
      duration: args.duration,
    });
    if (args.scenarios) query.set("scenarios", args.scenarios);
    if (args.shard) query.set("shard", args.shard);
    if (args.surfaceOnly) query.set("surface", "only");
    else if (args.surface) query.set("surface", "1");
    for (const [param, value] of Object.entries(args.surfaceParams)) {
      query.set(param, value);
    }
    const targetUrl = `${base}/gpu-bench/index.html?${query.toString()}`;
    console.error(`[gpu-flame-bench] navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "load" });

    // Timing-based evidence that the activity badge actually engages: ~2s
    // should land inside the CPU-timed phase, ~8s (on the default 4s
    // duration) inside the GPU-timed phase that follows it. Best-effort —
    // there's no page hook to wait on instead, so a screenshot racing page
    // state (or a scenario finishing unusually fast/slow) must never fail
    // the run; it just means a less useful PNG.
    await sleep(2_000);
    await screenshotBestEffort(page, path.join(outDir, "progress-1.png"));
    await sleep(6_000);
    await screenshotBestEffort(page, path.join(outDir, "progress-2.png"));

    console.error(
      `[gpu-flame-bench] waiting up to ${benchTimeoutMs}ms for __BENCH_DONE__/__BENCH_ERROR__...`,
    );
    await page.waitForFunction(
      () =>
        window.__BENCH_DONE__ === true || window.__BENCH_ERROR__ !== undefined,
      undefined,
      { timeout: benchTimeoutMs, polling: 250 },
    );

    const results = await page.evaluate(() => window.__BENCH_RESULTS__ ?? null);
    const pageError = await page.evaluate(() => window.__BENCH_ERROR__ ?? null);

    const screenshotPath = path.join(outDir, "page.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.error(`[gpu-flame-bench] screenshot written to ${screenshotPath}`);

    // Per-canvas element screenshots (cpu/gpu/diff per scenario) — full-res
    // artifacts for eyeballing agreement, independent of page layout. The
    // surface-DE section's canvases now outnumber `labels` (fr-p8bc's
    // shade A/B leg adds a variable base/cheap/diff triple per pose ×
    // probe width), so each canvas's own `data-bench-label` attribute (set
    // by `surfaceLabeledCanvas` in main.ts) wins the filename suffix when
    // present; the positional `labels` array is the fallback for canvases
    // that don't set one (the flame scenarios' cpu/gpu/diff triple, and
    // leg A's/leg B's fixed canvases) — unchanged from before this leg
    // existed, then a bare index for anything past both.
    for (const scenario of await page.locator(".scenario").all()) {
      const name = (await scenario.locator("h2").innerText())
        .split("—")[0]
        .trim();
      const canvases = await scenario.locator("canvas").all();
      const labels = ["cpu", "gpu", "diff"];
      for (let i = 0; i < canvases.length; i++) {
        const benchLabel = await canvases[i].getAttribute("data-bench-label");
        const suffix = benchLabel ?? labels[i] ?? String(i);
        const canvasPath = path.join(outDir, `${name}-${suffix}.png`);
        await canvases[i].screenshot({ path: canvasPath });
      }
    }
    console.error(`[gpu-flame-bench] per-canvas screenshots written`);

    const resultsPath = path.join(outDir, "results.json");
    await writeFile(resultsPath, JSON.stringify(results, null, 2));
    console.error(`[gpu-flame-bench] results written to ${resultsPath}`);

    console.log(JSON.stringify(results, null, 2));

    if (pageError) {
      console.error(
        `[gpu-flame-bench] page reported a fatal error:\n${pageError}`,
      );
      exitCode = 1;
    }
    // The flame agreement gate applies exactly as before, but only when the
    // flame scenarios actually ran — under --surface-only the page skips
    // them by design, so their vacuous "skipped" must not fail the run.
    const flameRan = !args.surfaceOnly;
    if (flameRan && results && results.agreement === "fail") {
      console.error(
        "[gpu-flame-bench] agreement check FAILED — see each scenario's comparison.pass in results.json",
      );
      exitCode = 1;
    }
    // "skipped" means no comparison ran at all (no WebGPU adapter) — a
    // check that verified nothing must not exit green, or a CI box that
    // silently loses WebGPU keeps passing while pinning nothing.
    if (flameRan && results && results.agreement === "skipped") {
      console.error(
        "[gpu-flame-bench] agreement check SKIPPED — no GPU comparison ran (no WebGPU adapter?); refusing to report success",
      );
      exitCode = 2;
    }
    if (surfaceRequested) {
      const surfaceDe = results ? results.surfaceDe : undefined;
      printSurfaceSummary(surfaceDe);
      if (surfaceDe && surfaceDe.verdict === "fail") {
        console.error(
          "[gpu-flame-bench] surface DE check FAILED — see results.surfaceDe in results.json",
        );
        exitCode = 1;
      } else if (surfaceDe && surfaceDe.verdict === "device-unreliable") {
        // fr-76pp: the device-sanity canary tripped mid-run — numeric rows
        // above are not kernel evidence (see results.surfaceDe.deviceSanity).
        console.error(
          "[gpu-flame-bench] surface DE device UNRELIABLE mid-run — rerun on a quiet machine (idle CPU); this run's numeric failures are NOT evidence of a kernel defect, do not bisect on them (see results.surfaceDe.deviceSanity)",
        );
        if (exitCode === 0) exitCode = 2;
      } else if (!surfaceDe || surfaceDe.verdict === "skipped") {
        // Same refusal as the flame gate: a surface section that verified
        // nothing must not exit green.
        console.error(
          "[gpu-flame-bench] surface DE section SKIPPED — no surface agreement ran; refusing to report success",
        );
        if (exitCode === 0) exitCode = 2;
      }
    }
  } finally {
    if (browser) await browser.close();
    killDevServer(devServer);
  }
  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error("[gpu-flame-bench] fatal:", err);
  process.exitCode = 1;
});
