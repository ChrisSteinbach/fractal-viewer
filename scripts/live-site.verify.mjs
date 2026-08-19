#!/usr/bin/env node
/**
 * Post-deploy LIVE-SITE smoke test.
 *
 * Deployment to GitHub Pages is `workflow_dispatch`-only (see CLAUDE.md's
 * Branching & Deployment section) — nothing runs it automatically on merge,
 * and nothing automatically checks what a dispatched run actually produced.
 * A deploy that ships a broken bundle (a bad build, a missing asset, a
 * service-worker regression) is otherwise caught only when a visitor
 * notices. This script is the machine check that runs right after
 * `gh workflow run deploy.yml`: it boots the REAL live origin in a real
 * browser — no dev server, no build directory, no localhost — and asserts
 * the same "did the app actually come up" signal `scripts/webgl-smoke.mjs`
 * uses against a local build, plus the two things only the live host can
 * prove: that GitHub Pages' own missing COOP/COEP headers got compensated
 * for by the service worker (`src/app/sw/sw.ts`), and that the one-time
 * cross-origin-isolation reload (`src/app/register-sw.ts`, exercised
 * end-to-end by `scripts/isolation-reload.verify.mjs` against a throwaway
 * local server) actually completes against the real deployed worker.
 *
 * What it checks, in order:
 *   1. The document responds with an HTTP OK status (2xx) — the deploy is
 *      actually serving something, not a dead domain or a broken redirect.
 *   2. The app boots: mirrors webgl-smoke.mjs's own pair of signals
 *      (`#pointCount` goes non-zero — the chaos game really ran — and
 *      `#error` stays empty — `main.ts`'s `showError()` never fired),
 *      checked on the SETTLED page, i.e. after any isolation reload has had
 *      the chance to run its course (see point 3).
 *   3. `window.crossOriginIsolated` is `true` by the end. On a first-ever
 *      visit (which is what a fresh Playwright context always is) GitHub
 *      Pages itself sends neither COOP nor COEP, so this can only be true
 *      once the service worker has installed, claimed the page, and the
 *      resulting `controllerchange` has fired exactly one
 *      `window.location.reload()` (`register-sw.ts`'s `reloadForIsolation`)
 *      whose reloaded navigation the worker then serves WITH those headers
 *      (`sw/sw.ts`'s `withIsolationHeaders`). This script does not drive
 *      that reload itself — it just tolerates it happening out from under
 *      it (see `waitForFunction` calls below, which survive a same-page
 *      navigation exactly like `isolation-reload.verify.mjs`'s own
 *      post-interaction wait does) and waits for the flag to land.
 *   4. `navigator.serviceWorker.controller` is non-null — the worker isn't
 *      just installed somewhere, it is the thing that answered the
 *      (possibly reloaded) navigation, which is what point 3 depends on.
 *   5. No unexpected console errors / uncaught page exceptions across the
 *      whole run (both the pre-reload and post-reload document). Known-
 *      benign noise, if any is ever measured on the live host, is filtered
 *      by `BENIGN_CONSOLE_PATTERNS` below — empty for now (see its doc);
 *      this repo prefers a measured filter over a guessed one
 *      (`flame-export.verify.mjs`'s `/SSL|service worker/i` filter exists
 *      for a documented reason specific to ITS local self-signed-cert
 *      scenario, not a template to copy blind here).
 *
 * Deliberate differences from webgl-smoke.mjs, beyond the live-vs-local
 * target:
 *   - No spawned dev server, no `--path`, no self-signed-cert tolerance:
 *     `ignoreHTTPSErrors` is left at its default (false) on purpose — a
 *     production TLS certificate that doesn't validate IS a real failure
 *     here, not local noise to swallow.
 *   - The overall wait budget is generous (90s default, `--timeout` to
 *     override) because this exercises real network + a real service-
 *     worker install/activate/claim cycle, not a warm localhost round trip.
 *
 * Usage:
 *   node scripts/live-site.verify.mjs [url] [--timeout=90000]
 *     [--screenshot=<path>]
 *
 *   [url]          Target to check (default: https://fractal-4d.com).
 *   --timeout      Overall budget in ms for everything after the browser is
 *                   launched — the initial navigation plus waiting out the
 *                   isolation reload plus waiting for boot (default 90000).
 *   --screenshot   Optional path to write a full-page screenshot to at the
 *                   end, whichever way the run went.
 *
 * Exit codes:
 *   0  PASS — every assertion above held.
 *   1  FAIL — the browser reached the site and got a verdict, and at least
 *      one assertion did not hold. This is a real "the deploy is broken"
 *      signal.
 *   2  INCONCLUSIVE — the browser itself failed to launch, or the initial
 *      navigation never got a response at all (DNS failure, connection
 *      refused/timed out, TLS handshake failure). Treat as an environment
 *      or network problem on the CHECKING side, not a verdict on the site —
 *      rerun rather than treating it as a failed deploy. The printed error
 *      still names what happened, for a human to judge.
 *
 * Prints a `[live-smoke] VERDICT: PASS|FAIL|INCONCLUSIVE` line at the end.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const DEFAULT_URL = "https://fractal-4d.com";
const DEFAULT_TIMEOUT_MS = 90_000;

/** Floor applied to each of the two post-navigation waits (isolation, boot)
 * via `remaining()` below, so a slow earlier step can never starve a later
 * one down to an unusably small timeout — see `remaining`'s doc. */
const WAIT_FLOOR_MS = 15_000;

/** Comfortably above `MOBILE_BREAKPOINT` (640, src/app/constants.ts) so the
 * app boots with its normal desktop layout — matches webgl-smoke.mjs's and
 * isolation-reload.verify.mjs's own viewport for the same reason. Boot
 * itself doesn't depend on panel visibility, but there's no reason to
 * diverge from the convention. */
const VIEWPORT = { width: 1280, height: 900 };

/**
 * Known-benign console/page-error noise to exclude from assertion 5.
 * Deliberately EMPTY: nothing about a clean production load is known to be
 * noisy yet. Add a pattern here only once a real run against the live site
 * has actually measured one — see this file's header on why a guessed
 * filter isn't good enough (and flame-export.verify.mjs's own filter for
 * what a justified one looks like).
 */
const BENIGN_CONSOLE_PATTERNS = [];

function isBenignConsoleText(text) {
  return BENIGN_CONSOLE_PATTERNS.some((re) => re.test(text));
}

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    screenshot: undefined,
  };
  const rest = [...argv];
  if (rest.length > 0 && !rest[0].startsWith("--")) {
    args.url = rest.shift();
  }
  for (const raw of rest) {
    if (!raw.startsWith("--")) {
      throw new Error(
        `Unrecognized argument: ${raw} (flags must start with --)`,
      );
    }
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    switch (key) {
      case "timeout":
        args.timeout = Number(value);
        break;
      case "screenshot":
        args.screenshot = value;
        break;
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) {
    throw new Error(
      `--timeout must be a positive number, got: ${String(args.timeout)}`,
    );
  }
  // Fail fast on a malformed target rather than letting Playwright's own
  // error message be the only clue.
  new URL(args.url);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.error(`[live-smoke] target: ${args.url}`);

  const deadline = Date.now() + args.timeout;
  /** Remaining budget, floored at `floorMs` so a slow earlier wait can never
   * starve a later one to (near) zero — see WAIT_FLOOR_MS's doc. This can
   * push total wall-clock slightly past `args.timeout` in the worst case;
   * that's a deliberate trade for "every assertion gets a fair chance"
   * over "never overshoot the nominal budget". */
  function remaining(floorMs = 1_000) {
    return Math.max(floorMs, deadline - Date.now());
  }

  const results = [];
  function record(label, ok, detail) {
    console.error(
      `[live-smoke] ${ok ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`,
    );
    results.push({ label, ok });
  }
  function skip(label, reason) {
    console.error(`[live-smoke] SKIP — ${label} (skipped: ${reason})`);
    results.push({ label, ok: false });
  }

  let browser = null;
  let gotResponse = false;
  let exitCode = 2;
  try {
    // The SwiftShader launch recipe, copied from scripts/webgl-smoke.mjs
    // (see its header for exactly why each piece matters — bundled-Chromium
    // executable, `--headless=new` requested explicitly rather than via
    // Playwright's `headless: true`, DISPLAY removed). This script targets
    // a live origin instead of a spawned dev server, but it still needs a
    // REAL WebGL context to reach assertion 2 (the chaos game actually has
    // to run), and this environment has no guaranteed GPU any more than
    // webgl-smoke.mjs's does — the whole point of this gate is working
    // unattended in exactly that kind of box.
    const env = { ...process.env };
    delete env.DISPLAY; // force offscreen SwiftShader, not a broken X11-forwarded GLX
    console.error(
      "[live-smoke] launching the Playwright-bundled Chromium with SwiftShader...",
    );
    browser = await chromium.launch({
      executablePath: chromium.executablePath(),
      headless: false, // MUST be false — see webgl-smoke.mjs's header for why
      env,
      args: [
        "--headless=new",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--no-sandbox",
      ],
    });

    // A fresh, unpersisted browser (not launchPersistentContext) — every run
    // starts with no cookies, no localStorage, no registered service
    // worker, i.e. guaranteed "first-ever visit" semantics, which is
    // exactly the scenario that arms the isolation reload at all.
    const page = await browser.newPage({
      viewport: VIEWPORT,
      // Deliberately NOT set (default false): this targets a production
      // origin whose TLS certificate must actually validate. See header.
    });

    // `load`, not `framenavigated`: the latter also fires for same-document
    // URL changes (persist.ts's `history.replaceState` writing the initial
    // `#v1=` scene hash right after boot fires one of those on every single
    // run), which would make this counter noisy on every healthy pass.
    // `load` only fires for a real document navigation — exactly the
    // initial load plus, on a healthy run, the one isolation reload.
    let navigations = 0;
    page.on("load", () => {
      navigations++;
      console.error(
        `[live-smoke] document load #${navigations}: ${page.url()}`,
      );
    });

    const consoleErrors = [];
    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === "error" || type === "warning") {
        process.stderr.write(`[page:${type}] ${text}\n`);
      }
      if (type === "error" && !isBenignConsoleText(text)) {
        consoleErrors.push(`[console.error] ${text}`);
      }
    });
    page.on("pageerror", (err) => {
      const text =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      process.stderr.write(`[page:uncaught] ${text}\n`);
      if (!isBenignConsoleText(text)) consoleErrors.push(`[uncaught] ${text}`);
    });

    console.error(`[live-smoke] navigating to ${args.url}`);
    const response = await page.goto(args.url, {
      waitUntil: "load",
      timeout: remaining(),
    });
    gotResponse = true; // past this point every outcome is a SITE verdict, not an environment one.

    const status = response ? response.status() : null;
    const httpOk = response !== null && response.ok();
    record(
      "page responds with an HTTP OK status",
      httpOk,
      `status: ${status ?? "no response"}, url: ${response ? response.url() : args.url}`,
    );

    const usable = httpOk;

    // Wait out the isolation reload (or its absence) BEFORE checking boot,
    // so assertion 2 is evaluated on the settled, post-reload page rather
    // than possibly catching the pre-reload document mid-flight. This
    // `waitForFunction` call survives the reload's own navigation exactly
    // like isolation-reload.verify.mjs's post-interaction wait does — no
    // special handling needed for the document swap underneath it.
    let isolationWaitOk = false;
    if (usable) {
      try {
        await page.waitForFunction(
          () => window.crossOriginIsolated === true,
          undefined,
          { timeout: remaining(WAIT_FLOOR_MS), polling: 250 },
        );
        isolationWaitOk = true;
      } catch (err) {
        console.error(
          `[live-smoke] isolation wait did not observe crossOriginIsolated=true: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Boot check, same signal as webgl-smoke.mjs — run after the isolation
    // wait above, so a reload that happened during it doesn't reset
    // #pointCount out from under a check that already passed.
    let bootWaitOk = false;
    if (usable) {
      try {
        await page.waitForFunction(
          () => {
            const err = document.getElementById("error");
            if (err && (err.textContent || "").trim().length) return true;
            const el = document.getElementById("pointCount");
            if (!el) return false;
            return Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
          },
          undefined,
          { timeout: remaining(WAIT_FLOOR_MS), polling: 200 },
        );
        bootWaitOk = true;
      } catch (err) {
        console.error(
          `[live-smoke] boot wait timed out: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (usable) {
      // One combined read so assertions 2-4 all describe the SAME instant,
      // rather than three separate evaluates that could straddle a race.
      const state = await page.evaluate(() => {
        const errEl = document.getElementById("error");
        const errText = errEl ? (errEl.textContent || "").trim() : "";
        const pointEl = document.getElementById("pointCount");
        const pointCount = pointEl
          ? Number((pointEl.textContent || "").replace(/[^\d]/g, ""))
          : 0;
        return {
          pointCount,
          bootError: errText.length ? errText : null,
          isolated: window.crossOriginIsolated,
          controlled: navigator.serviceWorker
            ? navigator.serviceWorker.controller !== null
            : false,
        };
      });

      record(
        "app booted (#error empty, #pointCount > 0)",
        bootWaitOk && state.bootError === null && state.pointCount > 0,
        state.bootError
          ? `#error: ${state.bootError}`
          : `points: ${state.pointCount}`,
      );
      record(
        "window.crossOriginIsolated === true by the end",
        state.isolated === true,
        `got ${String(state.isolated)}${isolationWaitOk ? "" : " — the isolation wait itself timed out"}`,
      );
      record(
        "a service worker is controlling the page",
        state.controlled === true,
        state.controlled
          ? undefined
          : "navigator.serviceWorker.controller is null",
      );
    } else {
      skip(
        "app booted (#error empty, #pointCount > 0)",
        "page did not respond OK",
      );
      skip(
        "window.crossOriginIsolated === true by the end",
        "page did not respond OK",
      );
      skip(
        "a service worker is controlling the page",
        "page did not respond OK",
      );
    }

    record(
      "no unexpected console errors",
      consoleErrors.length === 0,
      consoleErrors.length
        ? `${consoleErrors.length} error(s): ${consoleErrors.slice(0, 5).join(" | ")}`
        : undefined,
    );

    if (navigations > 2) {
      console.error(
        `[live-smoke] note: observed ${navigations} navigations — more than the one isolation reload this gate expects; not a failure on its own, but worth a look if this is unexpected.`,
      );
    }

    if (args.screenshot) {
      await mkdir(path.dirname(args.screenshot), { recursive: true });
      await page.screenshot({ path: args.screenshot, fullPage: true });
      console.error(`[live-smoke] screenshot written to ${args.screenshot}`);
    }

    const pass = results.length > 0 && results.every((r) => r.ok);
    console.error("[live-smoke] ======== SUMMARY ========");
    console.error(`[live-smoke] URL: ${args.url}`);
    console.error(`[live-smoke] navigations observed: ${navigations}`);
    for (const r of results) {
      console.error(`[live-smoke]   ${r.ok ? "PASS" : "FAIL"} — ${r.label}`);
    }
    console.error(`[live-smoke] VERDICT: ${pass ? "PASS" : "FAIL"}`);
    exitCode = pass ? 0 : 1;
  } catch (err) {
    const message =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    if (!gotResponse) {
      console.error(`[live-smoke] fatal (before any response): ${message}`);
      console.error(
        "[live-smoke] VERDICT: INCONCLUSIVE — could not launch the browser or reach the site; treat as an environment/network problem on the checking side, not a verdict on the deploy.",
      );
      exitCode = 2;
    } else {
      console.error(
        `[live-smoke] fatal (after the site responded): ${message}`,
      );
      console.error(
        "[live-smoke] VERDICT: FAIL — unexpected script error after the site had already responded.",
      );
      exitCode = 1;
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error("[live-smoke] fatal:", err);
  process.exitCode = 2;
});
