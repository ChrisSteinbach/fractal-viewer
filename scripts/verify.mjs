#!/usr/bin/env node
/**
 * THE WARM GATE RUNNER — `npm run verify -- gate [gate ...]`.
 *
 * Every verify gate today pays the same orchestration tax privately: a
 * ~40s production build (the caller's job, and dist-freshness refuses to
 * measure without one), a browser boot with GPU bring-up, a Mesa GLSL
 * link cliff on the first WebGL compile, and a machine-quiet baseline.
 * Run three gates after one edit and all of that is paid three times.
 *
 * The orchestrator pays each once and runs the named gates SEQUENTIALLY
 * inside the one session:
 *
 *   1. BUILD ONCE — skipped outright when dist/ is already fresh
 *      (dist-freshness's own staleness walk answers the skip question);
 *      `--fresh` forces, `ALLOW_STALE_DIST=1` keeps its escape-hatch
 *      meaning (measure what is there on purpose, no build).
 *   2. SERVE ONCE — the project's own vite preview, programmatically, on
 *      the default port. If the port already serves OUR build's exact
 *      entry asset (the caller's leftover `npm run preview` — the muscle
 *      memory half the gate headers teach), it is ADOPTED rather than
 *      fought; anything else on the port is refused with an exit 2 and
 *      `--preview-port` as the way out. vite preview reads dist/ per
 *      request, so one server outlives any number of rebuilds.
 *   3. BASELINE ONCE — the session's opening machine-quiet certification,
 *      taken before the browser is ours. Each gate STILL samples its own
 *      baseline at connect (the runner does it; the certification is
 *      per-run by design and the shared idle browser contributes ~0).
 *   4. BOOT ONCE — one Chromium per browser signature (the mode's display
 *      and launch args), reachable over CDP; gates receive the endpoint
 *      and the signature in their environment and
 *      `launchSurfaceBrowser` joins the session when the shape matches,
 *      else launches privately — gate code does not change to join, and
 *      with no orchestrator running nothing changes at all.
 *
 * WHY NOT A RESIDENT DAEMON PROCESS: everything the shared session keeps
 * warm dies with `npm run verify` and is re-created in a few seconds on
 * the next invocation — a cost that vanishes against the build and the
 * settles it amortizes. A resident daemon would add lifecycle state
 * (a leftover server a later run must discover, adopt or refuse) for no
 * acceptance gain. The gates' CDP handoff is the same either way.
 *
 * ISOLATION IS CHROMIUM'S (measured once, recorded in
 * docs/gate-velocity.md): a gate process that exits without cleanup —
 * crash, hang then kill — drops its CDP transport and Chromium destroys
 * the contexts that client created, so a crashed gate cannot leak into
 * the next leg; and `browser.close()` on a connectOverCDP client only
 * disconnects, so ordinary gate cleanup cannot kill the shared browser.
 * After a gate FAILS, this runner still recycles the browser (close +
 * relaunch, a couple of seconds) as cheap insurance against a wedged GPU
 * context a fresh page might inherit.
 *
 * `--watch` folds in the edit loop: a vite build --watch child rebuilds
 * each edit in seconds (rollup's in-memory graph, versus a ~40s cold
 * build), and on every completed rebuild the gate list runs again against
 * the same warm server and browser. A gate leg that overlaps the tail of
 * a rebuild can see a half-written dist/ and fail; the loop re-runs it
 * after the next build completes — the watch loop's failure mode is a
 * delayed re-verdict, never a false one.
 *
 * Exit codes follow the repo convention: 0 all gates passed, 1 any gate
 * verdict failed, 2 a checking/setup failure of this runner itself.
 * `--watch` runs until SIGINT (exit 130) and does not carry a verdict.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { chromium } from "playwright-core";
import {
  browserSignature,
  SHARED_BROWSER_CDP_ENV,
  SHARED_BROWSER_SIG_ENV,
  surfaceLaunchOptions,
} from "./lib/surface-browser-runner.mjs";
import { quietBaseline } from "./lib/machine-quiet.mjs";
import {
  assertFreshDist,
  guardFreshDist,
  REPO_ROOT,
  StaleDistError,
} from "./lib/dist-freshness.mjs";
import {
  formatGateResult,
  formatUsageError,
  gateInvocation,
  lineMarksBuildCompletion,
  parseVerifyArgs,
} from "./lib/verify-plan.mjs";

const viteBin = () => {
  const pkg = createRequire(import.meta.url).resolve("vite/package.json");
  return path.join(path.dirname(pkg), "bin", "vite.js");
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freeTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/** One HTTPS GET's status and body size, self-signed certs tolerated —
 * the preview server's cert is the project's own basic-ssl one. */
function httpsProbe(url) {
  return new Promise((resolve) => {
    const request = https.get(url, { rejectUnauthorized: false }, (res) => {
      let bytes = 0;
      res.on("data", (chunk) => {
        bytes += chunk.length;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, bytes }));
    });
    request.on("error", () => resolve({ status: 0, bytes: 0 }));
    request.setTimeout(4_000, () => {
      request.destroy();
      resolve({ status: 0, bytes: 0 });
    });
  });
}

/** Does the thing already listening on this port serve THIS checkout's
 * built bundle? Probe one content-hashed entry asset out of our own
 * dist/app/index.html: a different server answers 404, a different
 * checkout cannot reproduce the hash. */
async function servesOurBuild(candidate) {
  let html;
  try {
    html = await fs.readFile(
      path.join(REPO_ROOT, "dist/app/index.html"),
      "utf8",
    );
  } catch {
    return false;
  }
  const asset = /<script[^>]+src="\.\/(assets\/[^"]+?\.js)"/.exec(html)?.[1];
  if (!asset) return false;
  const probe = await httpsProbe(`${candidate}/${asset}`);
  return probe.status === 200 && probe.bytes > 0;
}

async function startPreviewServer(port, log) {
  try {
    const server = await preview({ preview: { port, strictPort: true } });
    const bound = server.httpServer?.address()?.port ?? port;
    const proto =
      (await httpsProbe(`https://localhost:${bound}/`)).status === 200
        ? "https"
        : "http";
    return { url: `${proto}://localhost:${bound}`, server, adopted: false };
  } catch (error) {
    // vite wraps the listen error without the EADDRINUSE code — the
    // message text is the stable part ("Port 4173 is already in use").
    const inUse =
      error?.code === "EADDRINUSE" ||
      /already in use|EADDRINUSE/i.test(String(error));
    if (!inUse) throw error;
  }
  const candidate = `https://localhost:${port}`;
  if (await servesOurBuild(candidate)) {
    log(`a vite preview already serves our dist on ${candidate} — adopting it`);
    return { url: candidate, server: null, adopted: true };
  }
  console.error(
    formatUsageError(
      `port ${port} is already serving something that is not this build's preview.\n` +
        `Stop it (its contents are not this dist), or move this run with --preview-port=N.`,
    ),
  );
  process.exit(2);
}

async function runChild(command, args, { env, onLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: onLine ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (onLine) {
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8");
        stream.on("data", (chunk) => {
          for (const line of chunk.split("\n")) onLine(line);
        });
      }
    }
    child.on("error", (error) => {
      console.error(`[verify] child failed to spawn: ${error.message}`);
      resolve(125);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/** Build once for the whole run. Skipped when dist/ is already fresh —
 * the same staleness walk a gate's refusal uses, asked as a question
 * instead of an exit. */
async function ensureBuilt(args, log) {
  if (process.env.ALLOW_STALE_DIST && !args.fresh) {
    await guardFreshDist();
    log("ALLOW_STALE_DIST set — measuring what is there, no build");
    return { built: false, buildMs: 0, skipped: true };
  }
  try {
    if (!args.fresh) {
      await assertFreshDist();
      log("dist/ is fresh — skipping the build (--fresh forces one)");
      return { built: false, buildMs: 0, skipped: true };
    }
    log("--fresh — building");
  } catch (error) {
    if (!(error instanceof StaleDistError)) throw error;
    log(
      error.reason === "missing"
        ? "nothing has been built — building once for the whole run"
        : "dist/ is stale — building once for the whole run",
    );
  }
  const startedAt = Date.now();
  const licensesExit = await runChild(process.execPath, [
    "scripts/collect-third-party-licenses.mjs",
  ]);
  if (licensesExit !== 0) throw new Error("license collection failed");
  const buildExit = await runChild(process.execPath, [viteBin(), "build"]);
  if (buildExit !== 0) throw new Error("vite build failed");
  return { built: true, buildMs: Date.now() - startedAt, skipped: false };
}

async function waitCdpEndpoint(port, timeoutMs = 20_000) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${endpoint}/json/version`);
      if (res.ok) return endpoint;
    } catch {
      // Not up yet — Chromium binds the DevTools server after the process
      // spawns; that trail is normal.
    }
    if (Date.now() > deadline) {
      throw new Error(`Chromium CDP endpoint did not come up on ${endpoint}`);
    }
    await sleep(100);
  }
}

/** The session's ONE browser: the runner's own launch options for the
 * requested mode, plus a DevTools port the gates' CDP clients connect to. */
async function launchSharedBrowser(mode) {
  const startedAt = Date.now();
  const cdpPort = await freeTcpPort();
  const launch = surfaceLaunchOptions(mode);
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false,
    env: launch.env,
    args: [...launch.args, `--remote-debugging-port=${cdpPort}`],
  });
  const cdpEndpoint = await waitCdpEndpoint(cdpPort);
  return {
    browser,
    cdpEndpoint,
    sig: browserSignature(mode),
    mode,
    bootMs: Date.now() - startedAt,
  };
}

function sessionEnv(session) {
  return {
    [SHARED_BROWSER_CDP_ENV]: session.cdpEndpoint,
    [SHARED_BROWSER_SIG_ENV]: session.sig,
  };
}

async function recycleSession(session) {
  await session.browser.close().catch(() => {});
  return launchSharedBrowser(session.mode);
}

/** Run the whole plan once. Returns the CURRENT session — a failed leg's
 * recycle REPLACES it, and the caller must carry the replacement forward
 * (a stale closed browser would fail every leg after it). */
async function runIteration(steps, session, label) {
  const results = [];
  for (const step of steps) {
    if (step.skipped !== null) {
      console.error(`[verify] SKIP ${step.target} — ${step.skipped}`);
      results.push({
        target: step.target,
        exit: null,
        wallMs: 0,
        skipped: step.skipped,
      });
      continue;
    }
    if (step.note) console.error(`[verify] NOTE ${step.target} — ${step.note}`);
    console.error(
      `[verify] --- ${step.target} ${step.args.join(" ")}`.trimEnd(),
    );
    const startedAt = Date.now();
    const exit = await runChild(process.execPath, [step.script, ...step.args], {
      env: sessionEnv(session),
    });
    const result = {
      target: step.target,
      exit,
      wallMs: Date.now() - startedAt,
      skipped: null,
    };
    results.push(result);
    if (exit !== 0) {
      console.error(
        `[verify] ${step.target} exited ${exit} — recycling the shared browser before the next gate.`,
      );
      session = await recycleSession(session);
    }
  }
  console.error(`[verify] === ${label} results ===`);
  for (const result of results) {
    console.error(`[verify] ${formatGateResult(result)}`);
  }
  const ran = results.filter((r) => r.skipped === null).length;
  const failed = results.filter(
    (r) => r.skipped === null && r.exit !== 0,
  ).length;
  console.error(`[verify] ${label}: ${ran} ran, ${failed} failed`);
  return { results, failed, session };
}

/** Repeated awaitable that resolves once per COMPLETED production build of
 * a `vite build --watch` child. One scanner attaches to the child's pipes
 * ONCE (a per-iteration waiter would stack listeners), and every
 * "built in" line resolves all pending waiters. */
function buildEvents(watcher) {
  const waiters = [];
  const onLine = (line) => {
    if (line.trim().length > 0) console.error(`[watch] ${line}`);
    if (lineMarksBuildCompletion(line)) {
      for (const resolve of waiters.splice(0)) resolve();
    }
  };
  for (const stream of [watcher.stdout, watcher.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      for (const line of chunk.split("\n")) onLine(line);
    });
  }
  return () => new Promise((resolve) => waiters.push(resolve));
}

async function main() {
  let args;
  try {
    args = parseVerifyArgs(process.argv.slice(2));
  } catch (error) {
    console.error(formatUsageError(error.message));
    process.exit(2);
  }
  if (args.targets.length === 0) {
    console.error(
      formatUsageError(
        "name at least one gate (registry name or scripts/*.mjs path)",
      ),
    );
    process.exit(2);
  }

  const log = (line) => console.error(`[verify] ${line}`);
  const t0 = Date.now();

  let watcher = null;
  let server = null;
  let session = null;
  let shuttingDown = false;
  const shutdown = (code) => {
    if (shuttingDown) process.exit(130);
    shuttingDown = true;
    console.error("[verify] shutting down the warm session");
    watcher?.kill("SIGTERM");
    session?.browser.close().catch(() => {});
    if (server) server.close().catch(() => {});
    process.exit(code ?? 130);
  };
  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(130));

  const dispose = async () => {
    watcher?.kill("SIGTERM");
    await session?.browser.close().catch(() => {});
    await server?.close().catch(() => {});
  };

  try {
    let build;
    if (args.watch) {
      // The watcher's first build IS this run's build; starting it first
      // folds an edit arriving mid-build into that pass instead of racing
      // a separate one.
      const licensesExit = await runChild(process.execPath, [
        "scripts/collect-third-party-licenses.mjs",
      ]);
      if (licensesExit !== 0) throw new Error("license collection failed");
      log("starting vite build --watch — its first pass is the run's build");
      watcher = spawn(process.execPath, [viteBin(), "build", "--watch"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      watcher.on("exit", (code) => {
        if (!shuttingDown) {
          console.error(`[verify] watch build exited (${code}) — stopping.`);
          shutdown(1);
        }
      });
      const nextBuild = buildEvents(watcher);
      const buildStartedAt = Date.now();
      await Promise.race([
        nextBuild(),
        sleep(600_000).then(() => {
          throw new Error("the watch build's first pass never completed");
        }),
      ]);
      build = { skipped: false, buildMs: Date.now() - buildStartedAt };
    } else {
      build = await ensureBuilt(args, log);
    }

    const previewed = await startPreviewServer(args.previewPort, log);
    server = previewed.server;

    // The session's opening baseline: nothing of ours is on the GPU yet —
    // the browser launches after this sample.
    const baselineStartedAt = Date.now();
    const quiet = await quietBaseline(log);
    const baselineMs = Date.now() - baselineStartedAt;

    session = await launchSharedBrowser(args.mode);
    const steps = args.targets.map((target) =>
      gateInvocation(target, args.mode, previewed.url),
    );

    const first = await runIteration(steps, session, "first pass");
    session = first.session;

    if (args.watch) {
      log(
        "watching — every rebuild re-runs the gates against the warm session (Ctrl-C to stop)",
      );
      const nextBuild = buildEvents(watcher);
      for (;;) {
        await nextBuild();
        await sleep(750); // let emptyOutDir's write settle before serving legs
        const pass = await runIteration(steps, session, "watch pass");
        session = pass.session;
      }
    }

    const totalMs = Date.now() - t0;
    console.error(
      `[verify] session accounting: build ${build.skipped ? "skipped (fresh)" : `${(build.buildMs / 1000).toFixed(1)}s`}` +
        ` · preview ${previewed.adopted ? "ADOPTED" : "booted"} · baseline ${(baselineMs / 1000).toFixed(1)}s` +
        ` · browser boot ${(session.bootMs / 1000).toFixed(1)}s (${args.mode})` +
        ` · machine ${quiet.contended === false ? "quiet" : quiet.contended === true ? "CONTENDED" : "UNKNOWN"}` +
        ` · wall ${(totalMs / 1000).toFixed(1)}s`,
    );
    process.exitCode = first.failed > 0 ? 1 : 0;
  } finally {
    await dispose();
  }
}

main().catch((error) => {
  console.error("[verify] fatal:", error);
  process.exitCode = 1;
});
