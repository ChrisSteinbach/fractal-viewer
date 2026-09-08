#!/usr/bin/env node
/** Rehearse renderer crash, browser SIGKILL and navigation with real Chromium, without
 * running GPU work. The synthetic completed row only checks artifact survival;
 * it is deliberately not an agreement result. No dev server is required. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import { startBenchDiagnostics } from "./gpu-bench-diagnostics.ts";
import { waitForBenchCompletion } from "../src/app/gpu-bench/runner-wait.ts";

async function until(predicate) {
  const deadline = Date.now() + 15_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Diagnostic rehearsal stalled");
    await sleep(100);
  }
}

for (const mode of ["browser-kill", "page-crash", "navigation"]) {
  const out = path.resolve("scripts/out/gpu-bench-diagnostics", mode);
  await mkdir(out, { recursive: true });
  const server = await chromium.launchServer({
    host: "127.0.0.1",
    headless: false,
    args: ["--headless=new", "--disable-gpu"],
  });
  let diagnostics;
  try {
    const browser = await chromium.connect(server.wsEndpoint());
    const page = await browser.newPage();
    diagnostics = startBenchDiagnostics(server, browser, page, out);
    const events = async () =>
      (await readFile(path.join(out, "browser-events.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    const partial = async () =>
      JSON.parse(
        await readFile(path.join(out, "partial-results.json"), "utf8"),
      );
    await page.setContent(
      '<span id="activityLabel">Synthetic in-flight work</span>',
    );
    await page.evaluate(() => {
      window.__BENCH_ACTIVE__ = "synthetic-in-flight";
      window.__BENCH_RESULTS__ = {
        scenarios: [{ name: "synthetic-completed" }],
        agreement: "skipped",
      };
    });
    await until(async () => (await partial())?.results?.scenarios.length === 1);

    if (mode === "browser-kill") {
      server.process().kill("SIGKILL");
      await until(async () =>
        (await events()).some((e) => e.kind === "browser-exit"),
      );
      const exit = (await events()).find((e) => e.kind === "browser-exit");
      assert.equal(exit.signal, "SIGKILL");
      assert.equal(exit.expected, false);
    } else if (mode === "page-crash") {
      const cdp = await page.context().newCDPSession(page);
      const crash = cdp.send("Page.crash").catch(() => {});
      await until(async () =>
        (await events()).some((e) => e.kind === "page-crash"),
      );
      diagnostics.stop();
      await server.close();
      await crash;
      const exit = (await events()).find((e) => e.kind === "browser-exit");
      assert.equal(exit.expected, true);
      assert.equal(exit.code, 0);
    } else {
      const wait = waitForBenchCompletion(page, {
        expectedUrl: page.url(),
        timeoutMs: 15_000,
        resetOnScenarioCompletion: false,
      }).then(
        () => null,
        (error) => error,
      );
      await page.goto("data:text/html,replacement page");
      assert.match((await wait).message, /benchmark navigated away/);
      // Let a sample of the replacement page run. It must preserve the last
      // completed benchmark row instead of overwriting it with null results.
      await sleep(1200);
      await page.evaluate(() => {
        window.__BENCH_RESULTS__ = { scenarios: [], agreement: "skipped" };
      });
      await sleep(1200);
      assert((await events()).some((e) => e.kind === "navigation"));
    }
    diagnostics.stop();
    await diagnostics.drain();
    const saved = await partial();
    assert.equal(saved.done, false);
    assert.equal(saved.active, "synthetic-in-flight");
    assert.equal(saved.results.scenarios[0].name, "synthetic-completed");
    assert.equal(saved.results.agreement, "skipped");
    console.log(
      `${mode}: partial row and unexpected failure evidence preserved`,
    );
  } finally {
    diagnostics?.stop();
    await server.close();
    await diagnostics?.drain();
  }
}
