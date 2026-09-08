/** Opt-in browser-exit evidence. Runs outside the page so a lost renderer
 * cannot erase its last completed results. No changes to agreement budgets,
 * deadline policy, or either dimension's production backend. */
import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserServer, Page } from "playwright-core";

export function startBenchDiagnostics(
  server: BrowserServer,
  browser: Browser,
  page: Page,
  outDir: string,
) {
  const started = Date.now();
  const eventPath = path.join(outDir, "browser-events.jsonl");
  const stderrPath = path.join(outDir, "browser-stderr.log");
  writeFileSync(eventPath, "");
  writeFileSync(stderrPath, "");
  writeFileSync(path.join(outDir, "partial-results.json"), "null\n");
  let stopping = false;
  let browserLost = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let lastSnapshot = "";
  let completed = 0;

  function event(kind: string, details: Record<string, unknown> = {}) {
    appendFileSync(
      eventPath,
      JSON.stringify({ elapsedMs: Date.now() - started, kind, ...details }) +
        "\n",
    );
  }

  const child = server.process();
  event("browser", {
    timestamp: new Date(started).toISOString(),
    pid: child.pid,
    version: browser.version(),
    command: child.spawnargs,
  });
  child.stderr?.on("data", (data: Buffer) => appendFileSync(stderrPath, data));
  child.on("exit", (code, signal) =>
    event("browser-exit", { code, signal, expected: stopping && !browserLost }),
  );
  browser.on("disconnected", () => {
    browserLost = !stopping;
    event("browser-disconnected", { expected: stopping });
  });
  page.on("crash", () => event("page-crash"));
  page.on("close", () => event("page-close", { expected: stopping }));
  page.on("pageerror", (error) => event("page-error", { error: error.stack }));
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) event("navigation", { url: frame.url() });
  });

  async function snapshot() {
    try {
      const state = await page.evaluate(() => ({
        url: location.href,
        done: window.__BENCH_DONE__ === true,
        error: window.__BENCH_ERROR__ ?? null,
        active: window.__BENCH_ACTIVE__ ?? null,
        activity: document.getElementById("activityLabel")?.textContent ?? null,
        results: window.__BENCH_RESULTS__ ?? null,
      }));
      // Navigating away must not erase completed work with an empty page.
      // The navigation event still records where it went.
      if (state.results === null || state.results.scenarios.length < completed)
        return;
      completed = state.results.scenarios.length;
      const serialized = JSON.stringify(state, null, 2);
      if (serialized !== lastSnapshot) {
        const target = path.join(outDir, "partial-results.json");
        writeFileSync(`${target}.tmp`, serialized + "\n");
        renameSync(`${target}.tmp`, target);
        lastSnapshot = serialized;
        event("progress", {
          active: state.active,
          activity: state.activity,
          completed: state.results?.scenarios.map((s) => s.name) ?? [],
          done: state.done,
        });
      }
    } catch (error) {
      if (!stopping) event("snapshot-error", { error: String(error) });
    }
  }

  function poll() {
    pending = snapshot().finally(() => {
      if (!stopping) timer = setTimeout(poll, 1000);
    });
  }
  poll();

  return {
    event,
    // Mark deliberate teardown before closing the browser; close releases
    // even a poll stuck in an unresponsive renderer. Drain only AFTER close.
    stop() {
      stopping = true;
      clearTimeout(timer);
    },
    async drain() {
      await pending;
    },
  };
}
