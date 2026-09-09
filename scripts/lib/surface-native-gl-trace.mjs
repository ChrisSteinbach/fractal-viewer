/** Optional native call observer launch. The preload must only forward existing
 * calls: this helper adds no GL probes and does not change browser flags. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  open,
  readFile,
  readlink,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { chromium } from "playwright-core";
import { surfaceLaunchOptions } from "./surface-browser-runner.mjs";

// Record only display/loader selection and diagnostic output, never the full
// inherited environment (which can carry unrelated credentials).
const REPORTED_ENV = [
  "DISPLAY",
  "XAUTHORITY",
  "LD_PRELOAD",
  "NATIVE_GL_TRACE",
  "NATIVE_GL_TRACE_STACK_AFTER_MS",
  "LIBGL_ALWAYS_SOFTWARE",
  "LIBGL_DRIVERS_PATH",
  "MESA_LOADER_DRIVER_OVERRIDE",
  "MESA_VK_DEVICE_SELECT",
  "DRI_PRIME",
  "GALLIUM_DRIVER",
  "EGL_PLATFORM",
  "__GLX_VENDOR_LIBRARY_NAME",
  "VK_ICD_FILENAMES",
  "VK_DRIVER_FILES",
];

async function commandFromNativeProcesses(tracePath, executablePath) {
  // Process init records precede the fixture. Bound this one-time read even if
  // the native observer has already recorded a busy browser startup.
  const trace = await open(tracePath, "r");
  const prefix = Buffer.alloc(256 * 1024);
  let bytesRead;
  try {
    ({ bytesRead } = await trace.read(prefix, 0, prefix.length, 0));
  } finally {
    await trace.close();
  }
  const pids = new Set();
  for (const line of prefix
    .subarray(0, bytesRead)
    .toString("utf8")
    .split("\n")) {
    try {
      const record = JSON.parse(line);
      if (
        record.kind === "init" &&
        Number.isSafeInteger(record.pid) &&
        record.pid > 0
      )
        pids.add(record.pid);
    } catch {
      // The final line may still be in flight in another process.
    }
  }
  const expectedExe = await realpath(executablePath);
  for (const pid of pids) {
    try {
      const command = (await readFile(`/proc/${pid}/cmdline`, "utf8"))
        .split("\0")
        .filter(Boolean);
      if (
        command.length === 0 ||
        command.some((arg) => /(?:^|\s)--type(?:=|\s|$)/.test(arg))
      )
        continue;
      const exe = await readlink(`/proc/${pid}/exe`).catch(() => null);
      let matchedBy = "executable";
      if (exe !== expectedExe) {
        const environment = await readFile(`/proc/${pid}/environ`, "utf8");
        if (!environment.split("\0").includes(`NATIVE_GL_TRACE=${tracePath}`))
          continue;
        matchedBy = "trace environment";
      }
      return {
        browserCommand: command,
        browserCommandSource: "/proc",
        browserCommandMeaning:
          "Observed NUL-delimited process command line; Chromium may rewrite original argv as one string",
        browserCommandMatchedBy: matchedBy,
        browserPid: pid,
      };
    } catch {
      // Startup helpers may already have exited, or /proc may be restricted.
    }
  }
  return {
    browserCommandUnavailableReason:
      "CDP metadata unavailable and no initialized native process matched the browser",
  };
}

export async function launchNativeGLTraceBrowser(mode, library, outdir) {
  assert.equal(process.platform, "linux", "--nativegltrace requires Linux");
  assert(path.isAbsolute(library), "--nativegltrace requires an absolute path");
  assert(!/[:\s]/.test(library), "LD_PRELOAD paths cannot contain separators");
  const bytes = await readFile(library);
  const tracePath = path.join(outdir, "native-gl-trace.jsonl");
  const eventsPath = path.join(outdir, "native-gl-trace-events.jsonl");
  const metadataPath = path.join(outdir, "native-gl-trace-run.json");
  // A reused artifact must never look like evidence from this browser. Require
  // a fresh outdir for repeat invocations; the native observer opens append-only.
  await writeFile(tracePath, "", { flag: "wx" });
  await writeFile(eventsPath, "", { flag: "wx" });
  const launch = surfaceLaunchOptions(mode);
  launch.env.LD_PRELOAD = [library, launch.env.LD_PRELOAD]
    .filter(Boolean)
    .join(":");
  launch.env.NATIVE_GL_TRACE = tracePath;
  const executablePath = chromium.executablePath();
  const metadata = {
    startedAt: new Date().toISOString(),
    harnessCommand: process.argv,
    workingDirectory: process.cwd(),
    library: {
      path: library,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    tracePath,
    eventsPath,
    observerContract:
      "Forward existing native calls without additional GL calls",
    observation: "LD_PRELOAD and host/CDP/proc metadata only; no GL probes",
    launch: { executablePath, headless: false, args: launch.args },
    environment: Object.fromEntries(
      REPORTED_ENV.map((key) => [key, launch.env[key] ?? null]),
    ),
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    flag: "wx",
  });
  const saveMetadata = () =>
    writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  async function mark(event, details = {}) {
    await appendFile(
      eventsPath,
      `${JSON.stringify({
        event,
        wallTimeMs: Date.now(),
        monotonicNs: process.hrtime.bigint().toString(),
        ...details,
      })}\n`,
    );
  }
  let browser;
  try {
    await mark("browser-launch");
    browser = await chromium.launch({
      executablePath,
      headless: false,
      env: launch.env,
      args: launch.args,
    });
    metadata.browserVersion = browser.version();
    // This browser-process metadata request issues no GL calls and runs before
    // any fixture page. Keep the same launch path as the uninstrumented gate.
    let session;
    try {
      session = await browser.newBrowserCDPSession();
      metadata.browserCommand = (
        await session.send("Browser.getBrowserCommandLine")
      ).arguments;
      metadata.browserCommandSource = "CDP";
      metadata.browserCommandMeaning = "Command line reported by Chromium CDP";
    } catch (error) {
      metadata.browserCommandCDPError = String(error);
    } finally {
      await session?.detach().catch((error) => {
        metadata.browserCommandCDPDetachError = String(error);
      });
    }
    if (!metadata.browserCommand?.length) {
      try {
        Object.assign(
          metadata,
          await commandFromNativeProcesses(tracePath, executablePath),
        );
      } catch (error) {
        metadata.browserCommandUnavailableReason = String(error);
      }
    }
    metadata.browserCommandAvailable = Boolean(metadata.browserCommand?.length);
    await saveMetadata();
    await mark("browser-ready");
  } catch (error) {
    metadata.launchError = String(error);
    await saveMetadata();
    await browser?.close().catch(() => {});
    throw error;
  }
  return {
    browser,
    mark,
    async captureProcesses() {
      const capture = {
        startedAt: new Date().toISOString(),
        commandLineMeaning:
          "Raw /proc cmdline snapshots may contain a rewritten process title instead of original argv",
        processes: [],
      };
      try {
        // Freeze the extent so concurrent native logging cannot prolong this
        // scan. Include call PIDs too: forked processes need not emit init.
        capture.traceBytes = (await stat(tracePath)).size;
        const pids = new Set();
        if (capture.traceBytes > 0) {
          const stream = createReadStream(tracePath, {
            end: capture.traceBytes - 1,
          });
          try {
            const lines = createInterface({
              input: stream,
              crlfDelay: Infinity,
            });
            for await (const line of lines) {
              try {
                const record = JSON.parse(line);
                if (Number.isSafeInteger(record.pid) && record.pid > 0)
                  pids.add(record.pid);
              } catch {
                // Ignore a trailing partial record at the frozen extent.
              }
            }
          } finally {
            stream.destroy();
          }
        }
        for (const pid of pids) {
          const processRecord = { pid, capturedAt: new Date().toISOString() };
          capture.processes.push(processRecord);
          try {
            const environment = await readFile(`/proc/${pid}/environ`, "utf8");
            if (
              !environment.split("\0").includes(`NATIVE_GL_TRACE=${tracePath}`)
            ) {
              processRecord.status = "skipped";
              processRecord.reason = "NATIVE_GL_TRACE does not match this run";
              continue;
            }
            const [maps, commandLine] = await Promise.all([
              readFile(`/proc/${pid}/maps`),
              readFile(`/proc/${pid}/cmdline`),
            ]);
            const basename = path.join(outdir, `native-gl-process-${pid}`);
            await writeFile(`${basename}.maps`, maps, { flag: "wx" });
            await writeFile(`${basename}.cmdline`, commandLine, { flag: "wx" });
            processRecord.status = "captured";
            processRecord.mapsPath = `${basename}.maps`;
            processRecord.commandLinePath = `${basename}.cmdline`;
          } catch (error) {
            processRecord.status =
              error.code === "ENOENT" ? "exited" : "unavailable";
            processRecord.error = String(error);
          }
        }
      } catch (error) {
        capture.error = String(error);
      }
      capture.finishedAt = new Date().toISOString();
      metadata.processCapture = capture;
      // Mapping is diagnostic. Even a metadata write failure must leave the
      // caller able to close Chromium and persist the rendering verdicts.
      await saveMetadata().catch((error) => {
        console.error(
          `Native process mapping metadata unavailable: ${String(error)}`,
        );
      });
      return capture;
    },
    async finish(details) {
      const traceBytes = (await stat(tracePath)).size;
      const observation = {
        traceBytes,
        observationAvailable: traceBytes > 0,
        ...(traceBytes === 0
          ? {
              observationUnavailableReason:
                "Native trace is empty; preloading or interception was not observed",
            }
          : {}),
      };
      // Nonempty output is only availability. Native hook coverage and fence
      // attribution require separate analysis of the captured call records.
      await mark("browser-closed", { ...details, ...observation });
      metadata.finishedAt = new Date().toISOString();
      Object.assign(metadata, details, observation);
      await saveMetadata();
      return observation;
    },
  };
}
