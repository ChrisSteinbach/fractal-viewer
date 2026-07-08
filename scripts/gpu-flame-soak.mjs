#!/usr/bin/env node
/**
 * fr-7su: live soak monitor for the PRODUCTION flame GPU path on a phone.
 *
 * fr-hs9 flipped `gpuPreference` to `"auto"` on coarse-pointer devices after
 * the /gpu-bench/ agreement + throughput validation passed; the one remaining
 * checklist item is a multi-minute, full-res soak of the REAL app (not the
 * bench page) to confirm no thermal/memory kill under sustained load. Unlike
 * `gpu-flame-bench.mjs` (which launches its OWN headless desktop Chrome), this
 * attaches to the phone's already-running Chrome over the DevTools Protocol —
 * you drive the app by hand on the phone; this just watches and logs.
 *
 * Two signal sources, because neither alone covers the failure modes:
 *   - CDP (the phone tab, via `adb forward`): the app's own on-screen notices
 *     (`#flameBackendNote` GPU-vs-CPU, `#flameSupersampleNote` budget clamp,
 *     `#renderError` worker-death pill), render progress (stall + per-render
 *     wall-clock -> thermal-throttle curve), and `performance.memory`.
 *   - adb shell (the OS): `/proc/meminfo` MemAvailable (the real OOM-pressure
 *     oracle — `performance.memory` is BLIND to the GPU storage buffer + the
 *     MAP_READ staging buffer that make up most of the ~900 MiB worst case),
 *     SoC temperature, and a logcat scan for the low-memory killer /
 *     device-lost. The one-time GPU adapter read also prints the device's
 *     real `maxStorageBufferBindingSize`, which settles item (c) directly.
 *
 * Prerequisites (all on the phone side, one-time):
 *   1. Developer Options -> USB debugging ON; plug in USB; tap "Allow".
 *   2. `adb devices` shows the phone as `device` (not `unauthorized` /
 *      `no permissions`).
 *   3. `adb forward tcp:9222 localabstract:chrome_devtools_remote`
 *   4. Open the LAN dev-server flame view on the phone and start a render.
 *
 * Usage:
 *   node scripts/gpu-flame-soak.mjs [--cdp=http://127.0.0.1:9222]
 *     [--interval=3000] [--minutes=0] [--adb=adb] [--pkg=com.android.chrome]
 *     [--out=soak-log]
 *
 * `--minutes=0` (default) runs until Ctrl-C; either way it prints a PASS/FAIL
 * summary on exit. `--adb=` (empty) disables the OS-side signals (e.g. when
 * pointing `--cdp` at a desktop Chrome to smoke-test the script itself).
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/** 32 bytes/bucket — the GPU histogram's per-cell footprint (see
 * `BYTES_PER_GPU_BUCKET` in `flame-gpu-backend.ts`); used only to translate
 * the adapter's `maxStorageBufferBindingSize` into a human "caps at N buckets"
 * note. */
const BYTES_PER_GPU_BUCKET = 32;

/** MemAvailable below this (kB) is flagged as memory pressure — a coarse
 * "getting close to the OOM killer" heuristic, not a hard threshold; the
 * authoritative kill signal is a logcat `lowmemorykiller`/`lmkd` line. */
const MEM_PRESSURE_KB = 300 * 1024;

/** Danger lines to surface out of logcat — the low-memory killer, an OOM
 * abort, or a GPU device-lost/watchdog (any of which would trip the flame
 * session's `gpuFailed` ratchet into CPU fallback). */
const LOGCAT_DANGER_RE =
  /lowmemorykiller|lmkd|Out of memory|OutOfMemory|DEVICE_LOST|GpuWatchdog|due to (?:host|GPU)|SIGABRT.*chrome/i;

/** Benign LMK/lmkd chatter that trips {@link LOGCAT_DANGER_RE} by keyword but
 * is NOT a kill: the daemon periodically logs that free memory sits above its
 * threshold ("device has enough memory NNNKib, disable killing"). Excluding
 * these keeps the OOM signal to ACTUAL kills, so a healthy phone with a chatty
 * LMK doesn't read as a soak failure. */
const LOGCAT_BENIGN_RE = /enough memory|disable killing|limit_killing/i;

function parseArgs(argv) {
  const args = {
    cdp: "http://127.0.0.1:9222",
    interval: 3000,
    minutes: 0,
    adb: "adb",
    pkg: "com.android.chrome",
    out: "soak-log",
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
      case "cdp":
        args.cdp = value.replace(/\/+$/, "");
        break;
      case "interval":
        args.interval = Number(value);
        break;
      case "minutes":
        args.minutes = Number(value);
        break;
      case "adb":
        args.adb = value;
        break;
      case "pkg":
        args.pkg = value;
        break;
      case "out":
        args.out = value;
        break;
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run an `adb shell ...` command, returning its stdout or `null` on any
 * failure (device gone, unauthorized, permission-denied `/sys` read) — every
 * OS-side signal is best-effort so a hiccup never aborts the soak. */
async function adbShell(adbPath, shellArgs) {
  if (!adbPath) return null;
  try {
    const { stdout } = await execFileP(adbPath, ["shell", ...shellArgs], {
      timeout: 8_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/** MemAvailable in kB from `/proc/meminfo`, or `null`. The kernel's own "how
 * much can be handed out without swapping/reclaim thrash" figure — a better
 * OOM-pressure proxy than free-list arithmetic. */
async function readMemAvailableKb(adbPath) {
  const out = await adbShell(adbPath, ["cat", "/proc/meminfo"]);
  if (!out) return null;
  const m = /MemAvailable:\s+(\d+)\s*kB/.exec(out);
  return m ? Number(m[1]) : null;
}

/** Hottest thermal reading in °C, or `null`. Prefers the framework's
 * `thermalservice` HAL dump (no root needed); falls back to raw
 * `/sys/class/thermal` zones (milli-°C, often permission-gated). */
async function readMaxTempC(adbPath) {
  const dump = await adbShell(adbPath, ["dumpsys", "thermalservice"]);
  if (dump) {
    const vals = [...dump.matchAll(/mValue=(-?[\d.]+)/g)].map((m) =>
      Number(m[1]),
    );
    const plausible = vals.filter((v) => v > 0 && v < 150);
    if (plausible.length) return Math.max(...plausible);
  }
  const sys = await adbShell(adbPath, [
    "cat",
    "/sys/class/thermal/thermal_zone*/temp",
  ]);
  if (sys) {
    const vals = [...sys.matchAll(/(\d{3,6})/g)].map(
      (m) => Number(m[1]) / 1000,
    );
    const plausible = vals.filter((v) => v > 0 && v < 150);
    if (plausible.length) return Math.max(...plausible);
  }
  return null;
}

/** Scan the current logcat buffer (cleared at startup) for the danger lines,
 * returning only those not seen before. */
async function readNewOomLines(adbPath, seen) {
  if (!adbPath) return [];
  let stdout;
  try {
    ({ stdout } = await execFileP(adbPath, ["logcat", "-d"], {
      timeout: 8_000,
      maxBuffer: 16 * 1024 * 1024,
    }));
  } catch {
    return [];
  }
  const fresh = [];
  for (const line of stdout.split("\n")) {
    if (
      LOGCAT_DANGER_RE.test(line) &&
      !LOGCAT_BENIGN_RE.test(line) &&
      !seen.has(line)
    ) {
      seen.add(line);
      fresh.push(line.trim());
    }
  }
  return fresh;
}

/** Read the flame app's on-screen state out of the phone tab in one round
 * trip. Mirrors exactly what a human would glance at (the three notices +
 * progress), plus the JS-heap figure. */
function readPageState() {
  const textIfShown = (id) => {
    const el = document.getElementById(id);
    if (!el || el.classList.contains("hidden")) return null;
    const t = (el.textContent || "").trim();
    return t.length ? t : null;
  };
  const progressEl = document.getElementById("flameProgress");
  const progressText = progressEl
    ? (progressEl.textContent || "").trim()
    : null;
  const pctMatch = progressText ? /\((\d+)%\)/.exec(progressText) : null;
  const mem = performance.memory
    ? {
        usedMb: Math.round(performance.memory.usedJSHeapSize / 1048576),
        limitMb: Math.round(performance.memory.jsHeapSizeLimit / 1048576),
      }
    : null;
  return {
    backend: textIfShown("flameBackendNote"),
    supersample: textIfShown("flameSupersampleNote"),
    renderError: textIfShown("renderError"),
    progressText,
    pct: pctMatch ? Number(pctMatch[1]) : null,
    mem,
  };
}

/** One-time environment probe: user agent + the GPU adapter's real limits.
 * `maxStorageBufferBindingSize` is the crux of fr-7su item (c): whether the
 * device is 128 MiB-class (full-res renders CPU-fall-back by design) or has
 * headroom for the whole 300 MiB accumulation budget on the GPU. */
async function probeEnvironment() {
  const ua = navigator.userAgent;
  let gpu = null;
  try {
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
    if (adapter) {
      const info = adapter.info || {};
      gpu = {
        vendor: info.vendor ?? null,
        architecture: info.architecture ?? null,
        description: info.description ?? null,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      };
    }
  } catch (err) {
    gpu = { error: String(err) };
  }
  return { ua, gpu };
}

/** Classify the backend notice into `"gpu" | "cpu" | null`. */
function classifyBackend(text) {
  if (!text) return null;
  if (/CPU/i.test(text)) return "cpu";
  if (/GPU/i.test(text)) return "gpu";
  return null;
}

function fmtClock(elapsedMs) {
  const s = Math.floor(elapsedMs / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(REPO_ROOT, args.out);
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(outDir, `soak-${stamp}.jsonl`);
  const summaryPath = path.join(outDir, `soak-${stamp}.summary.json`);

  console.error(`[soak] connecting to ${args.cdp} ...`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(args.cdp);
  } catch (err) {
    console.error(
      `[soak] could not attach to ${args.cdp}: ${err instanceof Error ? err.message : String(err)}\n` +
        `[soak] is the forward up?  adb forward tcp:9222 localabstract:chrome_devtools_remote\n` +
        `[soak] and is the phone authorized?  adb devices  (should say 'device')`,
    );
    process.exitCode = 1;
    return;
  }

  // Find the flame tab among all attached pages by probing for its DOM.
  let page = null;
  for (const context of browser.contexts()) {
    for (const candidate of context.pages()) {
      try {
        const isFlame = await candidate.evaluate(
          () => !!document.getElementById("flameProgress"),
        );
        if (isFlame) {
          page = candidate;
          break;
        }
      } catch {
        // Page may be a chrome:// or cross-origin tab we can't evaluate in.
      }
    }
    if (page) break;
  }
  if (!page) {
    const urls = browser
      .contexts()
      .flatMap((c) => c.pages().map((p) => p.url()));
    console.error(
      `[soak] no flame tab found (looked for #flameProgress). Open the flame ` +
        `view on the phone first.\n[soak] attached tabs: ${JSON.stringify(urls)}`,
    );
    await browser.close();
    process.exitCode = 1;
    return;
  }
  console.error(`[soak] attached to ${page.url()}`);

  const env = await page.evaluate(probeEnvironment);
  console.error(`[soak] UA: ${env.ua}`);
  if (env.gpu && env.gpu.maxStorageBufferBindingSize) {
    const lim = env.gpu.maxStorageBufferBindingSize;
    const buckets = Math.floor(lim / BYTES_PER_GPU_BUCKET);
    console.error(
      `[soak] GPU: ${env.gpu.description || env.gpu.architecture || "?"} ` +
        `maxStorageBufferBindingSize=${(lim / 1048576).toFixed(0)} MiB ` +
        `(GPU histogram caps at ~${buckets.toLocaleString()} buckets; ` +
        `above that, full-res renders CPU-fall-back by design)`,
    );
  } else {
    console.error(
      `[soak] GPU: no adapter / limits unavailable: ${JSON.stringify(env.gpu)}`,
    );
  }

  // Clear logcat so the OOM/device-lost scan only reports events from THIS run.
  if (args.adb) {
    await execFileP(args.adb, ["logcat", "-c"]).catch(() => {});
    const state = await execFileP(args.adb, ["get-state"])
      .then((r) => r.stdout.trim())
      .catch(() => "unavailable");
    if (state !== "device") {
      console.error(
        `[soak] WARNING: adb device state is '${state}' — OS-side thermal/memory/OOM ` +
          `signals will be blank until it reads 'device'. CDP signals still work.`,
      );
    }
  }

  await writeFile(
    logPath,
    JSON.stringify({ kind: "env", t: new Date().toISOString(), ...env }) + "\n",
  );

  // ---- Rolling soak state -------------------------------------------------
  const startedAt = Date.now();
  const seenOom = new Set();
  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    env,
    backendsSeen: new Set(),
    cpuFallbackAt: null, // elapsed ms of the first flip GPU->CPU
    renderErrorSeen: false,
    supersampleClampSeen: null, // the first clamp notice text
    minMemAvailKb: Infinity,
    maxTempC: -Infinity,
    completedRenders: [], // { durationS } per full 0->100 cycle
    oomLines: [],
    samples: 0,
  };

  // Per-render wall-clock tracking (throttle shows up as this GROWING).
  let renderStartAt = null;
  let prevPct = null;
  let stallPolls = 0;
  let evalFails = 0;

  let stop = false;
  const onSigint = () => {
    stop = true;
  };
  process.on("SIGINT", onSigint);

  const deadline =
    args.minutes > 0 ? startedAt + args.minutes * 60_000 : Infinity;
  console.error(
    `[soak] monitoring every ${args.interval}ms — ` +
      (args.minutes > 0 ? `for ${args.minutes} min` : `until Ctrl-C`) +
      `. Drive the phone: max the iteration slider, keep orbiting to sustain ` +
      `load, ramp supersample toward the memory ceiling.`,
  );

  while (!stop && Date.now() < deadline) {
    const now = Date.now();
    const elapsed = now - startedAt;

    let pageState;
    try {
      pageState = await page.evaluate(readPageState);
      evalFails = 0;
    } catch (err) {
      // A page reload (deliberate, to re-arm the GPU) destroys the execution
      // context and makes one evaluate reject — tolerate a burst of these and
      // reattach, rather than ending the soak on a transient blip. Give up
      // only after a sustained run of failures (~30s), i.e. the tab is
      // genuinely gone.
      evalFails += 1;
      console.error(
        `[soak] ${fmtClock(elapsed)} page evaluate failed (${evalFails}) — reload/navigation? ${err instanceof Error ? err.message : String(err)}`,
      );
      if (evalFails >= 10) {
        console.error(
          `[soak] giving up after ${evalFails} consecutive evaluate failures`,
        );
        break;
      }
      await sleep(args.interval);
      continue;
    }

    const [memAvailKb, tempC, oomLines] = await Promise.all([
      readMemAvailableKb(args.adb),
      readMaxTempC(args.adb),
      readNewOomLines(args.adb, seenOom),
    ]);

    const backend = classifyBackend(pageState.backend);
    if (backend) summary.backendsSeen.add(backend);

    // Render-cycle timing: a big pct drop starts a new render; hitting 100
    // completes one. A soak that throttles shows successive durations rising.
    if (pageState.pct != null) {
      if (prevPct != null && pageState.pct < prevPct - 5) {
        renderStartAt = now; // restarted (an orbit/param change re-accumulated)
      }
      if (renderStartAt == null) renderStartAt = now;
      if (pageState.pct >= 100 && (prevPct == null || prevPct < 100)) {
        const durationS = (now - renderStartAt) / 1000;
        summary.completedRenders.push({ durationS });
        console.error(
          `[soak] ${fmtClock(elapsed)} render reached 100% in ${durationS.toFixed(1)}s`,
        );
        renderStartAt = null;
      }
      // Stall watch: mid-render pct not advancing across several polls.
      if (prevPct != null && pageState.pct === prevPct && pageState.pct < 100) {
        stallPolls += 1;
        if (stallPolls === 4) {
          console.error(
            `[soak] ${fmtClock(elapsed)} WARNING: progress stuck at ${pageState.pct}% across ${stallPolls} polls — possible hang/device-lost`,
          );
        }
      } else {
        stallPolls = 0;
      }
      prevPct = pageState.pct;
    }

    // Alerts.
    if (backend === "cpu" && summary.cpuFallbackAt == null) {
      summary.cpuFallbackAt = elapsed;
      console.error(
        `[soak] ${fmtClock(elapsed)} WARNING: backend note is CPU (${pageState.backend}) — ` +
          `GPU path fell back (device-lost / limit guard / thermal). This is a soak FAIL signal.`,
      );
    }
    if (pageState.renderError && !summary.renderErrorSeen) {
      summary.renderErrorSeen = true;
      console.error(
        `[soak] ${fmtClock(elapsed)} WARNING: render-error pill shown ("${pageState.renderError}") — a worker died.`,
      );
    }
    if (pageState.supersample && summary.supersampleClampSeen == null) {
      summary.supersampleClampSeen = pageState.supersample;
      console.error(
        `[soak] ${fmtClock(elapsed)} note: supersample clamped ("${pageState.supersample}") — at/near the memory budget.`,
      );
    }
    if (memAvailKb != null) {
      summary.minMemAvailKb = Math.min(summary.minMemAvailKb, memAvailKb);
      if (memAvailKb < MEM_PRESSURE_KB) {
        console.error(
          `[soak] ${fmtClock(elapsed)} WARNING: MemAvailable ${(memAvailKb / 1024).toFixed(0)} MB — memory pressure.`,
        );
      }
    }
    if (tempC != null) summary.maxTempC = Math.max(summary.maxTempC, tempC);
    for (const line of oomLines) {
      summary.oomLines.push(line);
      console.error(`[soak] ${fmtClock(elapsed)} WARNING logcat: ${line}`);
    }

    // Compact status line.
    const parts = [
      fmtClock(elapsed),
      `backend=${backend ? backend.toUpperCase() : "—"}`,
      `pct=${pageState.pct != null ? pageState.pct + "%" : "—"}`,
      pageState.mem ? `heap=${pageState.mem.usedMb}MB` : "heap=—",
      memAvailKb != null
        ? `memAvail=${(memAvailKb / 1024).toFixed(0)}MB`
        : "memAvail=—",
      tempC != null ? `temp=${tempC.toFixed(1)}°C` : "temp=—",
      pageState.supersample ? "SS-CLAMP" : "",
      pageState.renderError ? "RENDER-ERROR" : "",
    ].filter(Boolean);
    console.error(`[soak] ${parts.join("  ")}`);

    summary.samples += 1;
    await appendFile(
      logPath,
      JSON.stringify({
        kind: "sample",
        t: new Date(now).toISOString(),
        elapsedMs: elapsed,
        backend,
        page: pageState,
        memAvailKb,
        tempC,
        newOomLines: oomLines,
      }) + "\n",
    );

    await sleep(args.interval);
  }

  process.off("SIGINT", onSigint);
  await browser.close(); // detaches from the phone tab; does NOT close it.

  // ---- Verdict ------------------------------------------------------------
  const durations = summary.completedRenders.map((r) => r.durationS);
  const throttlePct =
    durations.length >= 2
      ? ((durations.at(-1) - durations[0]) / durations[0]) * 100
      : null;
  const backendsSeen = [...summary.backendsSeen];
  const pass =
    summary.cpuFallbackAt == null &&
    !summary.renderErrorSeen &&
    summary.oomLines.length === 0 &&
    backendsSeen.includes("gpu") &&
    !backendsSeen.includes("cpu");

  const finalSummary = {
    ...summary,
    backendsSeen,
    minMemAvailMb:
      summary.minMemAvailKb === Infinity
        ? null
        : Math.round(summary.minMemAvailKb / 1024),
    maxTempC: summary.maxTempC === -Infinity ? null : summary.maxTempC,
    completedRenderDurationsS: durations,
    throttlePct,
    durationMin: (Date.now() - startedAt) / 60_000,
    verdict: pass ? "PASS" : "FAIL",
  };
  delete finalSummary.minMemAvailKb;
  await writeFile(summaryPath, JSON.stringify(finalSummary, null, 2));

  console.error("\n[soak] ======== SUMMARY ========");
  console.error(
    `[soak] duration: ${finalSummary.durationMin.toFixed(1)} min, ${summary.samples} samples`,
  );
  console.error(`[soak] backend(s) seen: ${backendsSeen.join(", ") || "none"}`);
  console.error(
    `[soak] CPU fallback: ${summary.cpuFallbackAt == null ? "none" : "at " + fmtClock(summary.cpuFallbackAt)}`,
  );
  console.error(
    `[soak] render-error pill: ${summary.renderErrorSeen ? "SHOWN" : "never"}`,
  );
  console.error(
    `[soak] supersample clamp: ${summary.supersampleClampSeen ?? "none"}`,
  );
  console.error(
    `[soak] min MemAvailable: ${finalSummary.minMemAvailMb ?? "—"} MB`,
  );
  console.error(
    `[soak] max temp: ${finalSummary.maxTempC != null ? finalSummary.maxTempC.toFixed(1) + "°C" : "—"}`,
  );
  console.error(
    `[soak] completed renders: ${durations.length}` +
      (durations.length
        ? ` (${durations.map((d) => d.toFixed(1) + "s").join(", ")}` +
          (throttlePct != null
            ? `; ${throttlePct >= 0 ? "+" : ""}${throttlePct.toFixed(0)}% slower end-to-start`
            : "") +
          ")"
        : ""),
  );
  console.error(
    `[soak] OOM/device-lost logcat hits: ${summary.oomLines.length}`,
  );
  console.error(`[soak] VERDICT: ${finalSummary.verdict}`);
  console.error(`[soak] log: ${logPath}`);
  console.error(`[soak] summary: ${summaryPath}`);

  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error("[soak] fatal:", err);
  process.exitCode = 1;
});
